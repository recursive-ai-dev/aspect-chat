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
