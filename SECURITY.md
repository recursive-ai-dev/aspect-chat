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

### 3. [ACCEPTED RISK] Aspect Data Stored in `localStorage`
- **Location:** `src/js/modules/settings.js`, `src/js/modules/state.js`, `src/js/modules/aspects.js` (`aspects_data`, provider/model settings, dark mode).
- **Vulnerability Class:** Sensitive local data not isolated from script-level access
- **Analysis:** `aspects_data` (Aspect names, instructions, knowledge, tool source) and provider/model settings persist in `localStorage` rather than IndexedDB. The API key itself is explicitly *not* persisted (`localStorage.removeItem('apiKey')` on every save — see `settings.js`), so no credential is at rest. The remaining exposure is: any XSS on this origin could read a user's saved Aspects. Per item 2 above, there is currently no reachable stored-XSS vector in the app, so this is a defense-in-depth gap rather than an active exploit path.
- **Recommendation (deferred):** Migrate `aspects_data` to IndexedDB (already used for knowledge files and memory) for consistency and defense-in-depth. Requires a one-time migration path for existing users' saved data — scoped as a follow-up, not a blocker for this release.

---
*Last reviewed as part of the client handoff pass. Re-run this review if the workflow builder gains an import feature, or if any user-supplied HTML is added to the DOM without sanitization.*
