# 🚀 Performance Audit Report

### 1. [RESOLVED] Render/Compute Waste - Inefficient DOM Re-rendering in Chat
- **Location:** `src/js/modules/chat.js` (lines ~13-90, inside `renderChatMessages`)
- **Baseline Measurement:** 5800ms for 10 renders of a 1000-message chat history.
- **Root Cause:** The `renderChatMessages` function was completely clearing the `#chat-messages` container (`container.innerHTML = ''`) and rebuilding the entire DOM tree for the entire chat history on every render call. This scales very poorly (O(N) DOM node creations per message on every state change, resulting in quadratic performance decay during rapid streaming).
- **Fix Applied:** Replaced the `innerHTML` wipe with a simple DOM diffing strategy. The function now reuses existing `.message-wrapper` elements, only appending new ones or removing excess ones. It also compares the memoized `msg._renderedHtml` with `bubble.innerHTML` before updating to avoid unnecessary DOM writes.
- **Post-Fix Measurement:** ~1800ms for the equivalent workload (more than 3x faster, scaling linearly rather than quadratically).
- **Regression Risk:** Verify that editing, deleting, and streaming messages still update the UI correctly without leaving stale content or duplicating messages.

### 2. [OPEN / DEFERRED] Blocking Operations - Unbatched DB Transactions for Knowledge Files
- **Location:** `src/js/modules/db.js` (`saveKnowledgeFile` loop in `uploadKnowledgeFiles`)
- **Baseline Measurement:** ~18.5ms per 100 files in IndexedDB memory mock (much slower in real browser disk I/O due to transaction overhead).
- **Root Cause:** In `uploadKnowledgeFiles`, `saveKnowledgeFile` is called in a loop for each page or extracted text chunk. Each call opens a new IndexedDB transaction and awaits its completion. Opening hundreds of sequential transactions for a large PDF adds noticeable overhead.
- **Status:** Not implemented in this pass — this is genuinely still the current behavior, not a completed fix. Scoped out because it requires a data-loss-safe rollout (partial-write handling for a batched transaction) that deserves its own test pass rather than a drive-by change.
- **Recommended fix:** Refactor `saveKnowledgeFile` to accept an array of `{aspectId, name, text}` entries and write them within a single `readwrite` transaction. Expected to cut IndexedDB overhead by 80-90% for multi-file/multi-page uploads.
- **Regression risk if implemented:** Verify that a failure partway through a batch correctly handles rollback or partial successes without corrupting the knowledge cache.
- **User-facing impact today:** Only noticeable when uploading many knowledge files or a very large multi-page PDF at once; a single-file upload is unaffected.

### 3. [RESOLVED] Full-Library Serialisation On Every Keystroke
- **Location:** previously `src/js/modules/state.js` (`saveAspectsToLocalStorage`), called from `markChangesUnsaved` on every `oninput` event.
- **Root Cause:** each keystroke in the Aspect editor ran `JSON.stringify` over the entire Aspect library — every persona, every tool's source, every base64 icon and background, and the full chat history — and wrote the result synchronously to `localStorage`, blocking the main thread. Cost grew with the size of the whole library, not with the size of the edit.
- **Fix Applied:** writes go to IndexedDB through `persist.js` and are debounced (400 ms), so a burst of typing produces one write instead of one per character. `flushSave()` is called on `visibilitychange`, `pagehide` and `beforeunload` so nothing is lost to the debounce window. The live `chatHistory` alias is stripped before serialisation, halving the serialised size of every conversation.
- **Regression Risk:** verify that edits made immediately before closing a tab still persist; `tests/persist.test.js` covers the debounce-collapse and flush paths.

### 4. [RESOLVED] WebLLM Bundled Into The Critical Path
- **Location:** `src/js/modules/webllm.js`.
- **Root Cause:** `@mlc-ai/web-llm` was imported statically, putting ~6 MB (2.1 MB gzipped) of in-browser inference runtime into the initial page load for every user, including the large majority who point Aspect Studio at a server and never touch WebLLM.
- **Fix Applied:** the module is now loaded with a dynamic `import()` on first use. Vite emits it as a separate chunk with no `modulepreload` hint, so it is fetched only when a WebLLM model is actually selected.
- **Measurement:** the eager entry bundle is 1.53 MB (449 KB gzipped); the WebLLM chunk is 6.04 MB and is no longer part of it.
