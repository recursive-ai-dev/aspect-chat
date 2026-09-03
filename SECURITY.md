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
- **Note on `src/js/modules/tools.js` (`executeJavaScriptTool`):** This is the engine that runs *user-authored* custom tools (the "Injectable JS Tools" feature advertised in the README). It also uses `new Function()` inside a dedicated Web Worker, but this is by design, not a defect — the whole feature is "let the user write/upload a JS tool and run it." The user authors and reviews this code themselves before it's attached to an Aspect; it is not code an LLM can inject at chat time. Mitigations already in place: execution happens in an isolated Web Worker (no access to `window`, `document`, or the main thread's `localStorage`/IndexedDB connections), and each tool only communicates back via a narrow `postMessage` protocol (result, memory read/write, aspect summon). Residual risk (the worker can still call `fetch`, so a malicious hand-authored tool could still perform SSRF from the user's browser) is accepted as inherent to a "run my own local JS tools" feature, same as browser dev tools or a userscript manager.

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

### 5. [BY DESIGN] Outbound Requests From Tool Workers
- **Location:** `src/js/modules/tools.js` (`executeJavaScriptTool`).
- **Analysis:** user-authored tools run in a Web Worker with no access to `window`, `document`, or the main thread's storage, and communicate only through a narrow `postMessage` protocol (result, memory read/write, aspect summon). They *can* call `fetch`, so a hand-authored tool can perform SSRF from the user's browser. This is inherent to a "run my own local JS tools" feature and is accepted, exactly as for a userscript manager or browser dev tools.
- **Change in this pass:** the execution timeout is now user-configurable (default 30s, previously a hard-coded 10s that made any network-using tool fail). The ceiling still exists; it is not unbounded.

### 6. [RESOLVED] Imported `.aspect` Tools Ran Without Review
- **Location:** `src/js/modules/zip.js` (`loadAspectFile`), `src/js/modules/tools.js` (`executeJavaScriptTool`).
- **Vulnerability Class:** Arbitrary code execution via a shared file.
- **Original Issue:** `.aspect` files are explicitly meant to be shared. Their tools are JavaScript that runs in a Web Worker with `fetch` access, and the model can invoke them (`[Run Tool: …]`) with no user step in between. An importer who never opens the editor would never see the code before it ran — via `SummonAspect` a hostile tool could also spend the importer's API credits and exfiltrate the reply.
- **Fix Applied:**
  - Imported Aspects that carry tools are stored with `toolsReviewed: false`. `executeJavaScriptTool` refuses to run any tool on such an Aspect and returns an explanatory error.
  - The editor shows a warning banner with a "Trust & enable tools" button (a `confirm()` gate) that sets `toolsReviewed: true`. Locally authored Aspects and older saves default to `true`, so nothing else changes.
  - `toolsReviewed` is never written into the exported `.aspect`, so the gate re-applies on every machine the file lands on.

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
  - The built app ships a `Content-Security-Policy` meta (injected by a build-only Vite plugin): `default-src 'self'`, `worker-src 'self' blob:`, `script-src 'self' 'wasm-unsafe-eval' blob:`, `object-src 'none'`, `base-uri 'self'`. `connect-src` stays `*` because the endpoint is user-configured; the dev server is unaffected.

---
*Last reviewed as part of the daily-driver hardening pass. Re-run this review if the workflow builder gains an import feature, or if any user-supplied HTML is added to the DOM without sanitization.*
