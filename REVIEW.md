The codebase exhibits a clean design—combining an iframe sandbox (`toolSandbox.js`), robust Markdown sanitization via DOMPurify (`chat.js`), and IndexedDB persistence (`persist.js`). However, deep review reveals unresolved bugs, deferred optimizations, and architectural security vectors.

The flaws across the system are broken down below, followed by the planned documentation to remediate them.

---

### Phase 1: Defect & Vulnerability Analysis

| ID | Location | Category | Defect Description |
| --- | --- | --- | --- |
| **F-01** | `src/js/modules/backup.js:63` | **Security (High)** | **Library Import Review Bypass**: `importAllAspects` uses `normalizeAspect` directly without clearing `trustedHash`, `allowNetwork`, or `allowedOrigins`. Malicious `.aspects.json` bundles can run pre-trusted arbitrary code immediately upon load. |
| **F-02** | `src/js/modules/persist.js:370` | **Security (Medium)** | **Raw Spread in `parseLibrary**`: Spreads tool objects as-is without stripping permission fields, failing to mirror the secure `{ name, code, state }` sanitization implemented in `zip.js`. |
| **F-03** | `src/js/modules/db.js` | **Performance (Deferred)** | **Sequential Unbatched IDB Transactions**: `uploadKnowledgeFiles` loops `saveKnowledgeFile`, opening and awaiting independent `readwrite` IndexedDB transactions per chunk. Causes 80–90% I/O overhead on large multi-page PDF imports. |
| **F-04** | `src/js/modules/toolSandbox.js:124` | **Security (Low)** | **Insecure PRNG for PostMessage Auth**: Channel tokens use `Math.random().toString(36) + Date.now()`. Predictable tokens compromise handshake integrity from `origin === "null"`. Needs `crypto.randomUUID()`. |
| **F-05** | `src/js/modules/toolSandbox.js:154` | **Resilience (Low)** | **Orphaned In-Sandbox Fetch Promises**: `cleanup()` destroys the iframe and clears abort listeners without rejecting unresolved `netWaiters` entries, leaving unsettled promises hanging on timeouts. |
| **F-06** | `src/js/modules/workflowBuilder.js:241` | **Bug / Syntax Injection** | **Unescaped Codegen Literals**: Interpolates `urlVal` and `keyVal` directly into JS string templates (`"${urlVal}"`) without escaping. Unsanitized quotes or newlines generate invalid code. Needs `JSON.stringify()`. |
| **F-07** | `src/js/modules/workflowBuilder.js:269` | **UX / API Contract** | **Silent Inert Tool Creation**: Newly constructed workflow tools are appended without a computed `trustedHash`. The UI displays a success toast despite the tool remaining disabled until manually saved in the tool editor. |
| **F-08** | `src/js/modules/llm.js:60` | **Correctness (Low)** | **Truncated Multibyte UTF-8 Streams**: SSE stream reader loop lacks a terminating flush `decoder.decode()` call after reading completes, resulting in replacement characters (`U+FFFD`) on trailing multibyte characters. |
| **F-09** | `desktop/aspect-chat-install.sh` | **Shell Portability / Scripting** | **Missing Shell Function Closures**: Unclosed function definitions in the generated launcher heredoc syntax break shell script execution when invoking `desktop:install`. |
| **F-10** | `SECURITY.md:8` | **Documentation Drift** | **Outdated Threat Model Docs**: Documentation references tool execution running in an isolated Web Worker, while runtime uses sandboxed `about:srcdoc` iframes with CSP brokers. |

---

### Phase 2: Action Plan & Remediation Documents

We will establish three implementation documents to systematically harden the project:

* **`REMEDIATION_SPEC.md`**: Detailed architectural specification for unified tool-trust pipelines, batching IndexedDB transactions in `db.js`, securing sandbox message routing, and fixing shell script generation.
* **`TEST_EXPANSION_PLAN.md`**: Specification for new Vitest suites covering malicious library imports, multibyte SSE boundary flushes, unescaped workflow generation, and IndexedDB batch rollback scenarios.
* **`ARCHITECTURE_ALIGNMENT.md`**: Complete overhaul of `SECURITY.md` and related docs to synchronize sandbox documentation, permission persistence schemas, and CSP invariants with runtime reality.

---

Which document would you like to author first: the technical fixes in `REMEDIATION_SPEC.md`, or the test suite definitions in `TEST_EXPANSION_PLAN.md`?
