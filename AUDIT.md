# Aspect-Chat Code Quality Audit

Read-only review. Findings are ranked by impact (most important first). Each item is a concrete, non-breaking fix (no new features, no new deps, no style-only changes). Overlap flags call out items that touch the same function/region so they are not applied in conflicting ways.

---

## 1. Worker source built with a template literal — user tools containing backticks or `${` silently break
**File / line:** `src/js/modules/tools.js:145-164` (`executeJavaScriptTool`, `const workerCode = \`... ${tool.code} ...\``)
**Problem:** The Web Worker source is assembled by interpolating `tool.code` into a JS *template literal*. Any backtick or `${` sequence inside a user-authored tool (e.g. `` `Hello ${name}` ``, very common in JS) prematurely terminates the outer template literal, producing invalid worker code. The worker then fails with a parse/syntax error and the tool result becomes `{"error":"Runtime error ..."}` even though the tool is valid.
**Why it matters:** Any legitimately-written tool that uses template literals or string interpolation fails every time. This is silent data loss of tool functionality, not a cosmetic issue.
**Fix:** Stop embedding `tool.code` inside a template literal. Build `workerCode` by array `.join('\n')` (or escape backticks/`${` before interpolation). Behavior for tools without those characters is identical; tools that currently break now work.
**Overlap:** None with other items — isolated to worker construction.

## 2. Global tool-result cache leaks results across different Aspects
**File / line:** `src/js/modules/tools.js:319-330` (`toolCache`, `getCachedOrExecuteTool`)
**Problem:** The cache key is only `` `${toolName}_${toolArgs}` ``. It is module-global and never scoped or cleared. If Aspect A runs `[Run Tool: DateTime]` and the user later switches to Aspect B and runs `[Run Tool: DateTime]`, B receives A's cached output. Same for `SummonAspect` (summoned aspect + prompt cached globally) and any side-effecting tool.
**Why it matters:** Different Aspects return each other's tool outputs; summoned-aspect responses and time-dependent tools return stale, wrong data. This is a correctness bug, not a cache feature.
**Fix:** Include the current aspect id in the cache key (e.g. `` `${state.currentAspectId}:${toolName}:${toolArgs}` ``). This preserves same-aspect caching behavior while fixing the cross-aspect leak. (Optionally also avoid caching volatile tools, but scoping by aspect is the minimal correct fix.)
**Overlap:** Touches the same `tools.js` file as items 1, 4, 5, 7, 12 but a distinct function (`getCachedOrExecuteTool` vs `executeJavaScriptTool`/`handleStreamResponse`/`sendAIRequest`). No conflict.

## 3. Icon/background data-URLs are mislabeled PNG and corrupt on .aspect round-trip (esp. SVG)
**File / line:** `src/js/modules/zip.js:21-29` and `:33-37` (save), `:117-122` and `:126-129` (load)
**Problem:** `saveAspectToFile` always writes the icon as `Icon.png` and the background as `Background.jpeg`, regardless of the actual MIME in the `data:` URL. The regex `^data:(image\/[a-z+]+);base64,(.+)$` *does* capture the real type (e.g. `image/svg+xml` for the default aspect icons), but it is discarded. On load, `Icon.png` is re-emitted as `data:image/png;base64,...` — so a saved SVG icon becomes an invalid `image/png` data URL and never renders.
**Why it matters:** Every default aspect (Studio Guide, etc.) uses an `image/svg+xml` icon. Saving and re-loading such an aspect permanently breaks its icon. PNG icons happen to survive only by luck.
**Fix:** Use the captured MIME group to choose both the file extension and the re-emitted `data:` type on load (e.g. map `svg+xml`→`.svg`/`image/svg+xml`, `png`→`.png`, `jpeg`/`jpg`→`.jpeg`). Keep the write/load logic consistent (see overlap).
**Overlap:** The save block (lines 21-29, 33-37) and load block (117-122, 126-129) must stay in sync — fix both halves together or the round-trip will still mismatch.

## 4. Trailing unterminated SSE line is dropped from the streamed response
**File / line:** `src/js/modules/tools.js:49-83` (`handleStreamResponse`)
**Problem:** The loop splits `pendingData` by `\n`, keeps the last fragment in `pendingData`, and only processes complete lines. On `done` it updates the bubble with `aiMessage` but **never parses the remaining `pendingData`**. If the final SSE event is a complete `data: {...}` line that was not terminated with a newline, it is silently discarded.
**Why it matters:** The last streamed delta (often the final token/closing punctuation or a trailing tool-call marker) can be lost, truncating the assistant message.
**Fix:** After the `while` loop, if `pendingData.trim()` is a non-empty `data:` line, process it (reuse the same per-line parsing) before the final `updateStreamingBubble`.
**Overlap:** Same streaming path as item 5 (`sendAIRequest`/`handleStreamResponse`). Apply item 4 inside `handleStreamResponse`; item 5 changes the abort branch in `sendAIRequest`. No conflict, but review together.

## 5. Abort (Stop) still posts a (possibly empty/partial) assistant message and can run tool calls
**File / line:** `src/js/modules/tools.js:388-399` (`sendAIRequest`)
**Problem:** On `AbortError` the code adds a "Generation stopped by user" log but then unconditionally continues to `await processAIResponseAndTools(aiMessage, aspect)`. If the abort happened before any token arrived, `aiMessage` is `""` → an empty assistant message is stored. If it happened mid-stream with a partial `[Run Tool: X]`, that partial is treated as a real tool call and executed.
**Why it matters:** Clicking Stop can leave a blank assistant bubble or trigger unintended tool execution from truncated text.
**Fix:** In the `catch`, only handle `AbortError`; on abort, `renderChatMessages()` (or just return) and `return` *before* calling `processAIResponseAndTools`. The `finally` still resets loading state and `abortController`. (This changes only the buggy stop path: no empty/partial message is added.)
**Overlap:** Streaming path, with item 4. Both modify behavior in the same try/finally; ensure the abort `return` doesn't bypass the `finally`.

## 6. `uploadTools` FileReader has no error handling — UI refresh can be skipped
**File / line:** `src/js/modules/ui.js:164-190` (`uploadTools`)
**Problem:** Each file is read with a `FileReader` whose `onload` increments `loadedCount` and only when `loadedCount === files.length` does it call `showEditorView()`/`markChangesUnsaved()`. There is no `onerror`. If any file fails to read, `onload` never fires, `loadedCount` never reaches the total, and the editor is never refreshed — the just-loaded tools are invisible until some other render.
**Why it matters:** A single corrupt/unreadable tool file leaves the UI stale and the user unaware that tools were (partially) loaded.
**Fix:** Convert each read to a promise and `await Promise.allSettled(...)` (or add `onerror` that also increments `loadedCount` and logs via `showToast`). Always call `showEditorView()`/`markChangesUnsaved()` in a `.finally()`.
**Overlap:** None.

## 7. `fetchAIResponseForAspect` assumes `data.choices[0].message.content` always exists
**File / line:** `src/js/modules/tools.js:124-125`
**Problem:** After a successful (non-2xx-caught) response, `return data.choices[0].message.content;` dereferences `data.choices[0].message` with no guard. Empty/`choices:[]` or a non-JSON body (`response.json()` itself can throw) crashes with a TypeError instead of a clear error.
**Why it matters:** A provider returning an empty choices array or a non-JSON body turns a recoverable error into an unhandled exception during summon, hanging the chat.
**Fix:** Guard with optional chaining and a fallback error: `const content = data?.choices?.[0]?.message?.content; if (content == null) throw new Error("Empty response from model."); return content;` and wrap `response.json()` in try/catch.
**Overlap:** None distinct; same module as several others but separate function.

## 8. `tempCreateIcon` persists across a cancelled “create aspect” modal → stale icon reused
**File / line:** `src/js/modules/aspects.js:456` (set), `:466` (used), `cancelCreateAspect` at `:488-490`
**Problem:** `uploadCreateIcon` stores the chosen file in `window.tempCreateIcon`. `cancelCreateAspect` (the only cancel path) never clears it. So: open create modal → upload an icon → cancel → later open create modal and create *without* uploading → `acceptCreateAspect` uses the stale `tempCreateIcon` from the abandoned attempt.
**Why it matters:** Users get an unexpected, previously-picked icon on a newly created aspect.
**Fix:** In `cancelCreateAspect`, set `window.tempCreateIcon = null;` before hiding the modal.
**Overlap:** None.

## 9. `renderChatMessages` re-parses and re-sanitizes every message on every full re-render
**File / line:** `src/js/modules/chat.js:12-88` (`renderChatMessages`, esp. `:26` and `:63`)
**Problem:** Each render calls `marked.parse(content)` + `DOMPurify.sanitize(...)` for *every* message, including ones already rendered. The app calls `renderChatMessages()` frequently (after every tool-execution system log, every message push, every edit). For long chats this is repeated, pointless markdown compilation/sanitization of immutable content.
**Why it matters:** Unnecessary CPU and jank on every interaction in a long conversation; pure redundant work.
**Fix:** Memoize the rendered HTML on the message object (e.g. cache `msg._renderedHtml` when content/role is unchanged and reuse it instead of re-parsing). Content is immutable once added, so memoization is safe and behavior-identical.
**Overlap:** None.

## 10. `getMemory` is an unused/dead export
**File / line:** `src/js/modules/db.js:34-45`
**Problem:** `getMemory` is exported but never imported or called anywhere in the app (only `saveMemory` is used, via the dynamic import in `executeJavaScriptTool`). It is dead code.
**Why it matters:** Dead surface area; if it were ever wired in it would look supported but is unused, and it adds maintenance noise. (Note: `resetCacheForTesting` is legitimately test-only — keep it.)
**Fix:** Remove `getMemory` (or, if intended, wire it where memory is read). Removing has no behavioral effect.
**Overlap:** None.

## 11. `workflowBuilder.js` attaches a DOM listener at module-import time without a null guard
**File / line:** `src/js/modules/workflowBuilder.js:185` (`document.getElementById('workflow-canvas').addEventListener('mousemove', ...)`)
**Problem:** This runs at top level when the module is imported (from `main.js`). If `workflow-canvas` is not present at import (missing/misnamed element, or future refactor), the statement throws and **aborts the entire app bootstrap**, since `main.js` statically imports this module.
**Why it matters:** A single missing element takes down the whole application instead of just the workflow feature.
**Fix:** Guard: `const canvas = document.getElementById('workflow-canvas'); if (canvas) canvas.addEventListener('mousemove', ...);` (same for the `mouseup` on `document`, which is safe).
**Overlap:** None.

## 12. A failing `saveMemory` inside the worker `writeMemory` handler can hang the chat indefinitely
**File / line:** `src/js/modules/tools.js:174-182` (`executeJavaScriptTool`, `writeMemory` branch)
**Problem:** The handler does `import('./db.js').then(async (dbModule) => { ... await dbModule.saveMemory(...); worker.postMessage({type:'memoryWriteComplete', ...}); })` with **no `.catch`**. If `saveMemory` rejects (IndexedDB error), `memoryWriteComplete` is never posted. The tool's `WriteMemory.js` listener then never resolves, so the worker never posts the final `success`, so the outer `await getCachedOrExecuteTool(...)` never resolves, so `sendAIRequest` hangs forever with the loading spinner stuck.
**Why it matters:** Any DB write error during a tool call permanently freezes the chat until reload.
**Fix:** Add `.catch` to the `.then` that posts `memoryWriteComplete` (with an error payload) so the tool's promise always settles; the outer promise should also have a safety timeout (`Promise.race` with a timeout) so a misbehaving worker cannot hang the UI.
**Overlap:** Same `executeJavaScriptTool` function as item 1. Apply item 1 (worker build) and item 12 (handler robustness) independently within the same function; keep the `.catch` addition separate from the worker-source change.

## 13. `getLakesideSageIcon` is exported/exposed but never used functionally
**File / line:** `src/js/modules/aspects.js:9` (def), `src/js/main.js:8,54` (exposed on `window`)
**Problem:** `getLakesideSageIcon` is defined and set on `window.getLakesideSageIcon`, but no aspect template or code path ever assigns its result as an icon (the default uses `getStudioGuideIcon()`). It is effectively dead public surface.
**Why it matters:** Dead code that implies a feature (a built-in "Lakeside Sage" aspect) that does not exist; misleads contributors.
**Fix:** Remove the export and the `window.getLakesideSageIcon` assignment, or actually wire it to an aspect template if intended. Removing is behavior-neutral.
**Overlap:** None.

## 14. `handleStreamResponse` silently swallows valid-JSON chunks that lack `choices[0]`
**File / line:** `src/js/modules/tools.js:66-76`
**Problem:** The per-line parsing (`JSON.parse` and the `data.choices[0].delta.content` access) sits inside a single `try/catch` labeled "Ignore partial JSON". A well-formed JSON SSE event that is missing `choices[0]` (e.g. a usage/finish metadata event, or an error-shaped object) is caught and discarded with no log, so a real content delta or an error payload can vanish silently.
**Why it matters:** Some providers interleave metadata/error events; those get dropped with zero visibility, and a provider error can look like an empty/partial response.
**Fix:** Narrow the `try` to only `JSON.parse`, then check `data?.choices?.[0]?.delta?.content` explicitly; log (don't silently ignore) events that parse but have no content delta, and surface error-shaped payloads.
**Overlap:** Same `handleStreamResponse` function as item 4. Item 4 fixes the trailing-line drop; item 14 tightens the per-line error handling — apply both within the same loop, careful not to duplicate the parse step.

---

### Summary of highest-impact fixes
- **#1** (backtick-breaking worker) and **#2** (cross-aspect cache leak) are the most damaging correctness bugs.
- **#3** (SVG icon corruption) silently breaks every default aspect on save/reload.
- **#4 / #5 / #12 / #14** are streaming/worker robustness issues that can truncate output, execute unintended tools on Stop, or hang the chat.
- Items **#6–#11, #13** are resilience/dead-code/redundant-work improvements with lower blast radius.

No item requires new dependencies, new options, or behavioral changes beyond correcting the described bug.
