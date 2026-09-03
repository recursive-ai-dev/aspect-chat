# 📋 Observability Notes

Silent-failure paths identified during review, with logging added so future
issues are diagnosable instead of disappearing into empty `catch` blocks.
All items below are implemented in the current codebase.

### 1. [RESOLVED] Swallowed JSON Parsing Error During Streaming
- **Location:** `src/js/modules/llm.js`, `readSSEStream`. (Originally in `tools.js`'s `handleStreamResponse`, which is now a thin wrapper over it so the SSE parsing lives in one place.)
- **Previous Blindness:** When a provider streams a malformed SSE chunk, the parse failure was silently ignored. If a specific provider/model started consistently returning malformed chunks (halting or corrupting the stream), there was no log output to diagnose it.
- **Fix Applied:** `console.warn("Failed to parse SSE JSON chunk", e.message, payload)` at the single parse site. There used to be two near-identical parse paths (per-line and final-flush); they were merged, so the log cannot drift between them. A stream that carries an `{"error": ...}` object after a 200 OK now throws with the server's message instead of being silently dropped as a chunk with no content delta.
- **What This Enables:** Detecting provider-specific streaming format bugs and tracking the frequency of malformed chunks across models, without breaking the stream parsing loop for expected partial chunks.

### 2. [RESOLVED] Missing Error Context on `.aspect` Import Parse Failures
- **Location:** `src/js/modules/zip.js` — `state.json` and `memory.json` parsing during `loadAspectFile`.
- **Previous Blindness:** On a corrupted `state.json` or `memory.json` inside an imported `.aspect` file, the app logged a bare "Failed to parse..." string with no underlying error detail.
- **Fix Applied:** Both catch blocks now log the original error message: `console.error("Failed to parse tool state.json during aspect import", e.message)` and the equivalent for `memory.json`.
- **What This Enables:** Identifying *why* an import failed (syntax error vs. unexpected structure) instead of just that it failed.

### 3. [RESOLVED] Missing Error Context on Settings Fetch Error
- **Location:** `src/js/modules/providers.js`, `describeHttpError`. (Moved out of `settings.js` when the provider layer was extracted.)
- **Previous Blindness:** If the provider's error response body wasn't valid JSON (e.g. a proxy/gateway returning an HTML 502 page), the parse failure was swallowed by an empty `catch(e){}`, obscuring that a non-JSON error occurred.
- **Fix Applied:** the error body is now read as text first and JSON-parsed opportunistically. A non-JSON body (an HTML 502 page from a gateway, a plain-text CORS message from a local engine) is surfaced verbatim in the user-facing error rather than being swallowed and replaced by the generic status text.
- **What This Enables:** Tracing proxy/gateway failures that return HTML instead of the expected JSON error structure — and, more usefully day to day, showing the user what the server actually said.

### 4. [RESOLVED] Silent Storage Failures
- **Location:** previously `src/js/modules/state.js` (`saveAspectsToLocalStorage`); now `src/js/modules/persist.js`.
- **Previous Blindness:** the Aspect library was written to `localStorage` with no error handling. Past the ~5 MB quota every write threw and was swallowed, so the app stopped saving with no log line, no toast, and no visible symptom until a reload revealed the loss.
- **Fix Applied:** Aspects moved to IndexedDB. Write failures reject, are recorded in `getLastPersistError()`, and are logged. Settings writes are individually guarded by `safeSet`/`safeRemove` in `settings.js`, which warn on failure instead of aborting the whole save.
- **What This Enables:** A storage failure is now diagnosable and, in the private-browsing case, non-fatal to the rest of the save.

### 5. [RESOLVED] Indistinguishable Local-Connection Failures
- **Location:** `src/js/modules/providers.js`, `describeConnectionError` and `testConnection`.
- **Previous Blindness:** a browser reports "server is down" and "server is up but refused the cross-origin request" as the same opaque `TypeError`. The app surfaced it as a bare `Network error: Failed to fetch`, which told the user nothing about which of the two it was — the single most common obstacle to getting a local model working.
- **Fix Applied:** failures against a local endpoint now produce a message naming the likely cause and the concrete fix (`OLLAMA_ORIGINS="*" ollama serve`, LM Studio's CORS setting). A **Test connection** button in Settings probes the endpoint on demand, and the mixed-content case (an HTTPS page reaching for `http://localhost`) is detected and explained separately.
- **What This Enables:** The user can distinguish and fix the failure themselves instead of filing it as "the app doesn't work".
