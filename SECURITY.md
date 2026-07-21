### 1. Critical - Unsafe Tool Execution via `new Function` in Web Worker Sandbox
- **Location:** `src/js/modules/tools.js` in `executeJavaScriptTool` wrapper template (lines 201), and `src/js/modules/aspects.js` in the Tinker default aspect `JSExecutor.js` (line 335) and `Calculate.js` (line 235).
- **Vulnerability Class:** Arbitrary Code Execution (XSS/RCE equivalent in browser context) / Sandbox Escape
- **Exploit Path:**
  1. An attacker provides a maliciously crafted Aspect with a custom tool via JSON import, or tricks the user into pasting code into the Tinker chat.
  2. The tool code is evaluated using `new Function()` inside a Web Worker.
  3. The attacker executes arbitrary JavaScript, allowing them to perform network requests (SSRF), exfiltrate data, or exploit the `postMessage` communication channel to compromise the main thread.
- **Impact:** Complete compromise of the Web Worker environment, potential data exfiltration of other context, SSRF, or main-thread compromise via message passing abuse.
- **Proposed Fix:** Replace `new Function()` and dynamic code execution with an AST-based parser or a secure JavaScript interpreter/evaluator designed for safe execution, as outlined in the memory instructions ("prefer explicitly defined AST-based parsers or safe evaluators to prevent Remote Code Execution vulnerabilities").
- **Regression Risk:** High. Any custom tools relying on dynamic evaluation of arbitrary strings will break.

### 2. High - Stored DOM XSS in Workflow Builder Configuration
- **Location:** `src/js/modules/workflowBuilder.js` lines 87-105.
- **Vulnerability Class:** DOM-based Stored XSS
- **Exploit Path:**
  1. An attacker imports a malicious workflow or aspect containing a workflow node with a crafted `configHtml` value (e.g., `<img src=x onerror=alert(1)>`).
  2. The application renders the workflow by concatenating strings into `innerHTML` without sanitization.
  3. The payload executes in the context of the main application.
- **Impact:** Attacker gains full control over the user's session, can steal locally stored configurations, and perform actions on the user's behalf.
- **Proposed Fix:** Use DOMPurify to sanitize `node.configHtml` before appending it to the `innerHTML` string, or create DOM elements using `document.createElement()` and `appendChild()` instead of concatenating raw HTML strings.
- **Regression Risk:** Low, assuming legitimate `configHtml` strings only contain basic form inputs (which are mostly static currently).

### 3. Medium - LocalStorage Storage of Sensitive User Settings
- **Location:** `src/js/modules/settings.js` lines 17-26 and `src/js/modules/state.js` lines 6-10, 20.
- **Vulnerability Class:** Insecure Storage of Sensitive Information
- **Exploit Path:**
  1. The application stores `aspects_data` and configuration preferences persistently in `localStorage`.
  2. An attacker with local access, or exploiting an XSS vulnerability (such as the one in the workflow builder), can read the contents of `localStorage` containing the user's custom aspects, knowledge bases, and potentially leaked data.
- **Impact:** Exposure of user data, prompts, and custom tool logic.
- **Proposed Fix:** Migrate sensitive configuration data and the `aspects_data` store from `localStorage` to IndexedDB, as indicated in memory instructions ("The application uses IndexedDB for local storage of knowledge files and memory.").
- **Regression Risk:** Medium, requires a careful data migration strategy for existing users from `localStorage` to IndexedDB on their next load.
