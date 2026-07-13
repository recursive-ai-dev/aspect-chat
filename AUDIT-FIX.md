# AUDIT-FIX — Implementation Pass

Same criteria as `AUDIT.md` (real bugs, correctness risks, redundant work, dead code, resilience), but every finding the fix-bar cleared was **fixed**, and everything uncertain was **flagged, untouched**. Fix-or-flag triage applied per item:

- **FIX** only when the correct behavior is unambiguous, the change is mechanical/local, and it is verifiable (existing test, new test, or close logic trace).
- **FLAG** when fixing would require guessing intent, has a wide blast radius, or isn't certain to be a real bug.

Verification: full suite run at the end (`npx vitest run`) → **161 tests pass across 11 files**. Three new tests added (see items 1, 4, 7). No lint/typecheck scripts exist in `package.json`; module correctness is covered by the suite, which imports every edited module.

---

## 1. Worker source built with a template literal — tools with backticks/`${` silently break  [FIXED]
**File:** `src/js/modules/tools.js` (worker construction in `executeJavaScriptTool`)
**Problem:** `workerCode` was assembled with a template literal interpolating `tool.code`. Any backtick or `${` in a user tool terminated the outer literal, producing invalid worker JS and a permanent `Runtime error` result for a valid tool.
**Why it matters:** Any tool using template literals/string interpolation (extremely common JS) never runs.
**Change:** Replaced the template literal with an array `.join('\n')` so `tool.code` is concatenated, never interpolated. Output for backtick-free tools is byte-for-byte equivalent.
**Verification:** New test `should build valid worker source even when tool code contains backticks` captures the generated worker source (via a `Blob` mock) and asserts (a) the backtick code is present intact and (b) `new Function(code)` parses without throwing. Passes.

## 2. Global tool-result cache leaks across Aspects  [FIXED]
**File:** `src/js/modules/tools.js` (`getCachedOrExecuteTool`)
**Problem:** Cache key was only `` `${toolName}_${toolArgs}` ``, module-global. Aspect B reused Aspect A's cached tool output (and cached `SummonAspect`/time-dependent results).
**Why it matters:** Different Aspects return each other's tool data; summoned-aspect responses and volatile tools return stale/wrong values.
**Change:** Scoped the key by current aspect: `` `${state.currentAspectId}:${toolName}:${toolArgs}` ``. Same-aspect caching behavior is preserved exactly (per the audit's minimal-correct-fix guidance).
**Verification:** Logic trace (key now distinct per aspect) + full suite green. (A behavioral test is impractical here because the Worker mock returns a constant regardless of args; the change is confined to the key string.)

## 3. Icon/background data-URLs mislabeled PNG/JPEG, corrupting SVG on round-trip  [FLAGGED]
**File:** `src/js/modules/zip.js:21-29, 33-37` (save), `:117-122, 126-129` (load)
**Problem:** Save always writes `Icon.png` / `Background.jpeg`; the captured MIME (`image/svg+xml` for default icons) is discarded, and load re-emits `data:image/png;base64,...`, breaking SVG icons after reload.
**Why flagged:** The fix requires a consistent contract across *both* the save and load functions (filename extension ↔ MIME mapping), there is **no existing `zip.test.js`**, and a wrong mapping would regress the round-trip for already-authored `.aspect` files. Changing two functions in lockstep with a guessed extension map is exactly the "blast radius / guessing intent" case.
**Shape of fix (for a human):** Derive `ext`+`type` from the regex MIME group on save (e.g. `svg+xml`→`.svg`/`image/svg+xml`, `png`→`.png`, `jpeg`/`jpg`→`.jpeg`), and on load detect the saved extension and re-emit the correct `data:` type. Add a jszip round-trip test (jszip runs in Node) before merging.

## 4. Trailing unterminated SSE line dropped from streamed response  [FIXED]
**File:** `src/js/modules/tools.js` (`handleStreamResponse`)
**Problem:** After the read loop, `pendingData` (a complete `data:` line with no trailing `\n`) was never parsed, so the final streamed delta could be lost.
**Why it matters:** Truncates assistant output (often the closing token or a trailing tool-call marker).
**Change:** After the loop, flush `pendingData` through the same per-line parsing (skip `[DONE]`, ignore partial JSON) before the final bubble update.
**Verification:** New test `should include a final SSE line that lacks a trailing newline` sends a last chunk ending in `data: {...}` with no `\n`; asserts the final assistant message is `"Hello"`. Passes. **Overlap:** shares the streaming path with item 5 (different functions; applied independently, no line conflict).

## 5. Abort (Stop) still posts a (possibly empty/partial) assistant message and can run tool calls  [FIXED]
**File:** `src/js/modules/tools.js` (`sendAIRequest`)
**Problem:** On `AbortError` it added the "stopped" log but then unconditionally ran `processAIResponseAndTools(aiMessage)`, storing an empty message or executing tool calls parsed from truncated text.
**Why it matters:** Clicking Stop could leave a blank bubble or trigger unintended tool execution.
**Change:** On `AbortError`, add the log, `renderChatMessages()`, and `return` before `processAIResponseAndTools`. The `finally` still resets loading state / `abortController`.
**Verification:** Existing test `should handle AbortError during stream` still asserts the "Generation stopped by user" log is present (no empty/partial assistant message is added now). Full suite green. **Overlap:** streaming path with item 4; `return` is in `sendAIRequest`'s catch, item 4 is in `handleStreamResponse` — no conflict.

## 6. `uploadTools` FileReader has no error handling — UI refresh can be skipped  [FIXED]
**File:** `src/js/modules/ui.js` (`uploadTools`)
**Problem:** Only `reader.onload` incremented `loadedCount`; a read error meant `loadedCount` never reached the total, so `showEditorView()`/`markChangesUnsaved()` never ran and loaded tools stayed invisible.
**Why it matters:** One unreadable tool file silently leaves the editor stale.
**Change:** Added a `reader.onerror` that increments `loadedCount` and performs the same refresh-on-complete as `onload`.
**Verification:** Logic trace (error path now reaches the refresh); full suite green (ui.test.js exercises `uploadTools` paths). No new test (would require FileReader error simulation; behavior change is localized and safe).

## 7. `fetchAIResponseForAspect` assumes `data.choices[0].message.content` exists  [FIXED]
**File:** `src/js/modules/tools.js` (`fetchAIResponseForAspect`)
**Problem:** `await response.json()` (and the `data.choices[0].message.content` access) threw an unhandled TypeError on empty `choices:[]` or non-JSON bodies, hanging the summon flow.
**Why it matters:** A provider returning an empty choices array or non-JSON body turned a recoverable error into an uncaught exception.
**Change:** Wrapped `response.json()` in `.catch(() => ({}))` and guarded with `data?.choices?.[0]?.message?.content`; throws `"Empty response from model."` when nullish.
**Verification:** New test `should throw on empty choices array` asserts rejection with `Empty response from model`. The two pre-existing fetch tests still pass. Full suite green.

## 8. `tempCreateIcon` persists across a cancelled create modal → stale icon reused  [FIXED]
**File:** `src/js/modules/aspects.js` (`cancelCreateAspect`; set in `uploadCreateIcon`)
**Problem:** `cancelCreateAspect` never cleared `window.tempCreateIcon`, so a later create-without-upload reused an abandoned icon.
**Why it matters:** Users get an unexpected previously-picked icon.
**Change:** `cancelCreateAspect` now sets `window.tempCreateIcon = null` before hiding the modal.
**Verification:** Logic trace; full suite green (aspects.test.js covers create/cancel paths). No new test (DOM-only; change is one line, unambiguous).

## 9. `renderChatMessages` re-parses + re-sanitizes every message on every full re-render  [FIXED]
**File:** `src/js/modules/chat.js` (`renderChatMessages`)
**Problem:** Every render re-ran `marked.parse` + `DOMPurify.sanitize` for all messages, though message content is immutable.
**Why it matters:** Repeated, pointless work on every interaction in a long chat (jank).
**Change:** Memoized the computed bubble HTML on the message object, keyed by `content` (`_renderedContent`/`_renderedHtml`), so it recomputes only when content changes (self-invalidating on `submitEdit`). Guarded with `typeof msg === 'object'` so a malformed/non-object entry can't throw (this also keeps the existing `regenerateMessage` test, which seeds `chatHistory` with bare numbers, passing).
**Verification:** Full suite green, including `chat.test.js` `renderChatMessages` and `regenerateMessage` tests. Output is identical for valid content.

## 10. `getMemory` is an unused/dead export  [FLAGGED]
**File:** `src/js/modules/db.js:34-45`
**Problem (per AUDIT):** `getMemory` is never imported by app code.
**Why flagged:** It *is* used by the test suite — `tests/db.test.js` imports and exercises `getMemory` (save/retrieve round-trip, empty-object case). Removing it would break `db.test.js`, so removal is not behavior-neutral and requires also editing the test. Not a confirmed app bug.
**Shape of fix (for a human):** Decide whether `getMemory` is intended public API (keep, and perhaps wire it where memory is read) or truly dead (remove the function *and* the two `db.test.js` cases that use it). This is a product/API decision, not a mechanical fix.

## 11. `workflowBuilder.js` attaches a DOM listener at import without a null guard  [FLAGGED]
**File:** `src/js/modules/workflowBuilder.js:185`
**Problem (per AUDIT):** `document.getElementById('workflow-canvas').addEventListener(...)` runs at module import; if the element were missing it would throw and abort bootstrap.
**Why flagged:** Defensive-only. `index.html` (and `dist/index.html`) *do* contain `#workflow-canvas`, so this is not a current bug. Adding a guard is strictly safe but addresses a hypothetical, not a confirmed defect; per the bar I'm not confident it's an actual bug.
**Shape of fix (for a human):** `const canvas = document.getElementById('workflow-canvas'); if (canvas) canvas.addEventListener('mousemove', ...);` — safe one-liner if desired for robustness.

## 12. Failing `saveMemory` inside the worker `writeMemory` handler can hang the chat  [FIXED]
**File:** `src/js/modules/tools.js` (`executeJavaScriptTool`, `writeMemory` branch)
**Problem:** `import('./db.js').then(async dbModule => { ... await dbModule.saveMemory(...); worker.postMessage({type:'memoryWriteComplete'}) })` had no `.catch`. If `saveMemory` (or the dynamic import) rejected, `memoryWriteComplete` was never posted → the tool's `WriteMemory.js` listener never resolved → the worker never posted final success → `getCachedOrExecuteTool` awaited forever → chat frozen on the spinner.
**Why it matters:** Any IndexedDB write error permanently hangs the chat until reload.
**Change:** Added `.catch` that logs and posts `memoryWriteComplete` (with the error), so the tool's promise always settles and the worker proceeds to its final result.
**Verification:** Logic trace (error path now always posts `memoryWriteComplete`); full suite green. No new test (would require a Worker + failing IndexedDB simulation). **Overlap:** same `executeJavaScriptTool` function as item 1; applied independently (item 1 = worker source build, item 12 = message-handler robustness), no line conflict.

## 13. `getLakesideSageIcon` is exported/exposed but never used functionally  [FLAGGED]
**File:** `src/js/modules/aspects.js:9` (def), `src/js/main.js:8,54` (exposed)
**Problem (per AUDIT):** No code path assigns its result as an icon.
**Why flagged:** It *is* exercised by `tests/aspects.test.js` (`describe('getLakesideSageIcon')` asserts the returned data URL). Removing the export + the `window` assignment would break that test. Not confirmed dead within the repo as a whole.
**Shape of fix (for a human):** Either keep it as tested public surface, or remove the function, its `main.js` import/assignment, *and* the `aspects.test.js` block together. Product decision, not mechanical.

## 14. `handleStreamResponse` silently swallows valid-JSON chunks lacking `choices[0]`  [FLAGGED]
**File:** `src/js/modules/tools.js:66-76`
**Problem (per AUDIT):** A well-formed SSE event with no `choices[0]` (usage metadata, or an error-shaped payload) is caught and discarded with no visibility.
**Why flagged:** The minimal safe part (don't swallow) overlaps item 4's fix, but the audit's full ask — "surface error-shaped payloads" — requires deciding *how* to surface (throw? append to message? log only?). That's a product decision (how errors should reach the user), not an unambiguous mechanical fix. Fixing only the "narrow the try" part without a chosen surfacing behavior would be a half-measure.
**Shape of fix (for a human):** Narrow the `try` to `JSON.parse` only, then explicitly check `data?.choices?.[0]?.delta?.content`; for error-shaped payloads (`data.error`), either throw into the `sendAIRequest` catch (so it becomes a visible "Error:" system log) or append. Pick one and add a streaming-error test.

---

## Summary
- **9 FIXED:** #1, #2, #4, #5, #6, #7, #8, #9, #12 — all verified by the green full suite; #1/#4/#7 additionally covered by new tests.
- **5 FLAGGED (untouched):** #3 (zip MIME, no test infra / two-function consistency contract), #10 (`getMemory` used by `db.test.js`), #11 (defensive-only; element present), #13 (`getLakesideSageIcon` used by `aspects.test.js`), #14 (ambiguous error-surfacing behavior).
- **Overlaps reconciled:** Items 1/2/4/5/7/12 all live in `tools.js` but in distinct functions — applied independently with no line conflicts. Items 4 & 5 share the streaming path but touch different functions (`handleStreamResponse` vs `sendAIRequest`); item 3's save/load halves are flagged together because they must change in lockstep.
- No new dependencies, no new config, no behavioral change beyond each corrected defect. The full suite passes (161 tests, 11 files).
