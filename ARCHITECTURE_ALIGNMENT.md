# ARCHITECTURE_ALIGNMENT.md: Documentation Reconciliation & Threat Model Alignment

This document synchronizes project documentation (`SECURITY.md`, `README.md`, and design notes) with the current production codebase, eliminating architecture drift and correcting inaccurate threat model assumptions.

---

### 1. Tool Sandbox Threat Model (`SECURITY.md: Item 1 & Item 5`)

**Drift Description:**
`SECURITY.md` previously described tool code running inside a Web Worker. The implementation uses an isolated, cross-origin `about:srcdoc` iframe with CSP broker isolation.

**Reconciliation Specifications:**

* **Replace Worker References with Iframe Sandbox Specifications**: Update documentation to specify that user-authored JavaScript executes within an ephemeral `<iframe sandbox="allow-scripts">` devoid of `allow-same-origin`.


* **Origin Boundary Guarantees**: State explicitly that omitting `allow-same-origin` forces an opaque `null` origin, causing any attempt by tool scripts to touch `window.parent`, DOM nodes, `localStorage`, `sessionStorage`, or `indexedDB` to fail.


* **Sandbox Network Policy**: Document that the iframe applies `<meta http-equiv="Content-Security-Policy" content="connect-src 'none'; default-src 'none'; script-src 'unsafe-inline';">`, disarming direct calls to `fetch`, `XMLHttpRequest`, `WebSocket`, and `EventSource`. All outbound requests must transit the parent broker (`brokerToolFetch`) via a cryptographically bound `postMessage` protocol.



---

### 2. Trust Model & Tool Review Gate (`SECURITY.md: Item 6`)

**Drift Description:**
Earlier iterations tracked tool authorization via a coarse `aspect.toolsReviewed` boolean flag. The production system uses cryptographic hashing per tool.

**Reconciliation Specifications:**

* **Granular Trust Hash (`tool.trustedHash`)**: Document that an Aspect tool is only trusted to execute if its current source code precisely matches an FNV-1a hash stored in `tool.trustedHash`.


* **Tamper-Evident Invalidation**: Explain that any modification to tool code in the editor or incoming via unvetted imports zeroes out or desynchronizes `trustedHash`, disabling automatic execution by LLM tool invocation markers (`[Run Tool: ...]`) until explicitly confirmed by the user.


* **Unified Pipeline Invariant**: Update documentation to mandate that **both** `.aspect` ZIP archives and whole-library `*.aspects.json` backups strip trust hashes and network configurations upon ingest.



---

### 3. Network Permissions: Origin-Scoped Grants (`SECURITY.md: Item 12`)

**Drift Description:**
Legacy text referred to `allowNetwork: true` as a permanent, all-or-nothing flag toggled on first request.

**Reconciliation Specifications:**

* **Origin-Scoped Allowlist (`tool.allowedOrigins`)**: Explicitly clarify that user consent is scoped strictly to the scheme + domain + port of the requested endpoint (e.g., `[https://api.weather.gov](https://api.weather.gov)`).


* **Re-Prompting Trigger**: Document that attempts by a tool to reach an undeclared origin re-triggers the parent user prompt, preventing SSRF pivot attacks where an approved API request is followed by an exfiltration attempt.


* **Transcript Logging**: Document that every outbound brokered request emits an immutable audit event directly into the chat transcript.



---

### 4. Storage Architecture & Persistence Invariants (`README.md` & `SECURITY.md`)

**Drift Description:**
The transition from synchronous `localStorage` to asynchronous `IndexedDB` required defensive failure recovery that needs formal documentation.

**Reconciliation Specifications:**

* **Persistence Arming**: Document that `persist.js` operates an "armed" flag pattern. If the initial load from IndexedDB fails (due to tab locks, private browsing restrictions, or disk errors), persistence disarms to block subsequent debounced writes from purging or overwriting user data.


* **Storage Distribution Matrix**:

| Data Category | Target Store | Retention & Security Policy |
| --- | --- | --- |
| **Aspect Definitions & Personas** | IndexedDB (`AspectKnowledgeDB`, store `aspects`)

 | Debounced 400ms writes; stripped live chat aliases; auto-snapshots (8 rolling)

 |
| **Knowledge Files & Extracted Chunks** | IndexedDB (`AspectKnowledgeDB`, store `knowledge`)

 | Batched compound key storage; isolated from iframe sandbox

 |
| **Cross-Session Aspect Memory** | IndexedDB (`AspectKnowledgeDB`, store `memory`)

 | Read/Write access strictly gated through parent broker calls

 |
| **Provider Config & Themes** | `localStorage`<br> | Stored plaintext in local browser origin

 |
| **API Keys** | `localStorage` / `sessionStorage`<br> | Controlled by "Remember API Key" toggle; omitted entirely for local models

 |

---

### 5. Dual Content-Security-Policy Pipeline (`vite.config.js` vs `index.html`)

**Drift Description:**
Audit finding F-009 noted ambiguity regarding the dev server CSP versus production CSP builds.

**Reconciliation Specifications:**

* **Static Baseline (`index.html`)**: Documents that `index.html` ships an explicit baseline CSP (`object-src 'none'; base-uri 'self'; frame-src 'self'; form-action 'none'`) to provide backstop protection when raw source directories are served via local file servers or plain HTTP daemons.


* **Production Build Injection (`vite.config.js`)**: Explains that the production build plugin (`cspPlugin`) replaces the baseline meta tag with the full strict policy:
```http
default-src 'self'; script-src 'self' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src * data: blob:; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none';

```


`connect-src *` is documented as an intentional requirement to accommodate user-defined inference endpoints and CDN weight retrieval for WebLLM.
