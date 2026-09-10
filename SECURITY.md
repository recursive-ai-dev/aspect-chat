# Security Model

This document describes the runtime security architecture of Aspect Studio. It
is written against the code as shipped, not as originally designed. Where
implementation differs from an earlier description, this document is authoritative.

---

## 1. Tool Sandbox — Iframe Isolation, not a Web Worker

Tool code runs inside an ephemeral `<iframe sandbox="allow-scripts">`. The
`allow-same-origin` token is deliberately omitted.

**What that means in practice:**

* The iframe receives a unique opaque origin (`null`). Any attempt by tool
  code to touch `window.parent`, `localStorage`, `sessionStorage`, or
  `indexedDB` throws a `SecurityError` — the tool cannot read Aspects,
  conversations, other tools' code, memory, or the API key.
* There is no handle to the parent DOM.
* Cookies are not accessible.
* The iframe is created fresh per execution and destroyed immediately after.

The iframe is *not* a Web Worker. Earlier versions of this document described
Web Workers; that description was incorrect.

---

## 2. Network Policy — Broker-Only Fetch

The sandboxed iframe carries this Content-Security-Policy:

```
default-src 'none'; script-src 'unsafe-inline'; style-src 'none'; connect-src 'none'
```

`connect-src 'none'` disarms direct network calls. Specifically:

* `fetch()` — replaced by a proxy that routes through the parent broker.
* `XMLHttpRequest` — stubbed to throw.
* `WebSocket` — stubbed to throw.
* `EventSource` — stubbed to throw.
* `navigator.sendBeacon` — set to `() => false`.

Every outbound request a tool makes must go through `brokerToolFetch` in the
parent, which is where the per-origin permission gate lives.

---

## 3. Network Permission Gate — Per-Origin Grants

When a tool calls `fetch()`, the parent broker:

1. Checks whether the requested `scheme://host:port` is in the tool's
   `allowedOrigins` list.
2. If not present, prompts the user before proceeding.
3. Records the user's answer scoped strictly to that origin (not "allow all
   network access").

An origin-scoped allowlist means approval of `https://api.weather.gov` does
**not** also approve `https://evil.example.com`. Attempts to reach an
undeclared origin always re-prompt the user, preventing SSRF pivots where
an approved endpoint is followed by an exfiltration attempt to a different host.

Every brokered outbound request emits an immutable audit event into the chat
transcript so the user can see what the tool contacted.

Network permissions (`allowNetwork`, `allowedOrigins`) are **per-tool** fields
stored inside the Aspect. They are **stripped on import** (see §6 below) and
can be revoked at any time from the tool's Network button in the editor.

---

## 4. Tool Trust — Per-Tool Cryptographic Hash

A tool is only trusted to execute if its current source code precisely matches
the `trustedHash` stored alongside it.

`trustedHash` is an FNV-1a hash of the tool's source (`hashToolCode` in
`aspects.js`). The hash is tamper-evident: any modification to tool code —
in the editor, or during an import — zeroes out or desynchronises the stored
hash, disabling automatic execution by LLM invocation markers
(`[Run Tool: ToolName.js({…})]`) until the user explicitly re-confirms the
code.

The check is `isToolTrusted(tool)`: `tool.trustedHash === hashToolCode(tool.code)`.

Workflow-builder tools are trusted at creation because the user authored the
pipeline on their own machine. All other paths that bring code onto the device
(ZIP import, library JSON import) strip `trustedHash` unconditionally.

---

## 5. Loop Guard

A single LLM response is limited to **15 consecutive tool invocations**. When
the limit is reached, the model is told it has exceeded the call budget and must
stop. This prevents runaway agentic loops from performing unbounded privileged
actions (memory writes, network requests, SummonAspect calls) without user
oversight.

Additionally, the parent broker caps **host-side actions per run** at 40. A
tool that fires `net-request`, `writeMemory`, or `summonAspect` messages faster
than the model can read is terminated.

---

## 6. Import Sanitization — Unified Trust Pipeline

Both import paths strip trust and permission fields before any code can execute:

### ZIP archives (`.aspect` files)

`zip.js → loadAspectFile` extracts `{ name, code, state }` for each tool and
sets `toolsReviewed: false` when tools are present. Fields `trustedHash`,
`allowNetwork`, and `allowedOrigins` are never read from the archive.

### Whole-library JSON (`.aspects.json` files)

`persist.js → sanitizeImportedAspect` is applied to every Aspect in the
incoming file before `normalizeAspect` runs. It:

* Retains only `{ name, code, state }` per tool.
* Explicitly drops `trustedHash`, `allowNetwork`, and `allowedOrigins`.
* Sets `toolsReviewed: false` whenever any tools are present.

`backup.js → importAllAspects` pipes through `sanitizeImportedAspect` before
handing Aspects to `normalizeAspect`, closing the F-01 library-import review
bypass.

A malicious `.aspects.json` file carrying pre-calculated `trustedHash` values
or pre-granted `allowedOrigins` cannot execute code or make network requests
without user review.

---

## 7. Postmessage Channel Authentication

Every message between the parent and the sandboxed iframe carries a
`channel` field set to a per-run cryptographic nonce generated with
`crypto.randomUUID()` (with a `getRandomValues` fallback for environments that
expose `crypto` but not `randomUUID`).

Because the iframe's origin is `"null"` (opaque), origin-based authentication
is unavailable. The nonce bound to a specific execution context prevents one
tool run from processing messages intended for another. The parent discards any
message whose `channel` does not match the current run's nonce.

---

## 8. Storage Architecture

| Data Category | Store | Security Notes |
|---|---|---|
| Aspect definitions, personas | IndexedDB (`aspects` store) | Debounced 400 ms writes; stripped of `chatHistory` on write; auto-snapshots (8 rolling) |
| Knowledge files & extracted chunks | IndexedDB (`knowledge` store) | Isolated from iframe sandbox; batch-written per `saveKnowledgeFileBatch` |
| Cross-session Aspect memory | IndexedDB (`memory` store) | Read/write only through the parent broker; not accessible from the sandbox directly |
| Provider config, themes | `localStorage` | Plaintext in the local browser origin |
| API keys | `localStorage` / `sessionStorage` | Controlled by the "Remember API Key" toggle; omitted entirely for keyless local models |

### Persistence arm/disarm

`persist.js` operates an **armed** flag. If the initial IndexedDB load fails
(disk pressure, tab lock, private-browsing restrictions), persistence disarms.
Subsequent debounced writes become no-ops, preventing a failed read from
triggering a save that would overwrite the store with an empty library.

---

## 9. Content-Security-Policy

### Development (`npm run dev`)

The dev server applies no CSP overrides. The baseline CSP in `index.html` is
active:

```
object-src 'none'; base-uri 'self'; frame-src 'self'; form-action 'none'
```

### Production build (`npm run build`)

The `cspPlugin` in `vite.config.js` replaces the baseline meta tag with:

```
default-src 'self';
script-src 'self' 'wasm-unsafe-eval' blob:;
worker-src 'self' blob:;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self' data:;
connect-src * data: blob:;
frame-src 'self';
object-src 'none';
base-uri 'self';
form-action 'none';
```

`connect-src *` is intentional: users can point Aspect Studio at any local or
hosted inference endpoint, and WebLLM downloads model weights from CDN URLs
that are not known at build time. Restricting `connect-src` would break both
use cases.

---

## 10. API Key Handling

The API key is stored in `localStorage` by default (controlled by the
"Remember API key" toggle). When the toggle is off, the key is kept only in
`sessionStorage` and cleared when the tab closes.

API keys are **never** sent to Aspect Studio's own servers — there are none.
They go directly in `Authorization` headers to the provider endpoint you
configure.

Local model servers (Ollama, LM Studio, llama.cpp, vLLM, KoboldCpp) do not
require an API key; the key field is hidden for those providers.

---

## 11. Threat Model Boundary

Aspect Studio is a browser application with no backend of its own. The threat
model covers:

* **Untrusted tool code** imported from `.aspect` or `.aspects.json` files.
* **LLM-driven tool invocation** of code that has not been reviewed by the user.
* **Network exfiltration** by a tool that obtains permission for one origin and
  attempts to reach another.
* **Storage attacks** via malicious library imports that attempt to forge trust
  state.

It does **not** cover:

* A compromised browser or OS.
* A malicious browser extension with access to the page's `window`.
* A provider endpoint that logs prompts (use local models if this is a concern).
* Physical access to the machine running the browser.

---

*Last updated to match the production codebase following the ARCHITECTURE_ALIGNMENT.md reconciliation. Supersedes all prior descriptions of Web Worker-based tool execution.*
