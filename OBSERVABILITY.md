# 📋 Observability Notes

Silent-failure paths identified during review, with logging added so future
issues are diagnosable instead of disappearing into empty `catch` blocks.
All items below are implemented in the current codebase.

### 1. [RESOLVED] Swallowed JSON Parsing Error During Streaming
- **Location:** `src/js/modules/tools.js`, `handleStreamResponse` (both the per-line and final-flush parse paths).
- **Previous Blindness:** When a provider streams a malformed SSE chunk, the parse failure was silently ignored. If a specific provider/model started consistently returning malformed chunks (halting or corrupting the stream), there was no log output to diagnose it.
- **Fix Applied:** `console.warn("Failed to parse SSE JSON chunk", e.message, dataStr)` in both catch blocks.
- **What This Enables:** Detecting provider-specific streaming format bugs and tracking the frequency of malformed chunks across models, without breaking the stream parsing loop for expected partial chunks.

### 2. [RESOLVED] Missing Error Context on `.aspect` Import Parse Failures
- **Location:** `src/js/modules/zip.js` — `state.json` and `memory.json` parsing during `loadAspectFile`.
- **Previous Blindness:** On a corrupted `state.json` or `memory.json` inside an imported `.aspect` file, the app logged a bare "Failed to parse..." string with no underlying error detail.
- **Fix Applied:** Both catch blocks now log the original error message: `console.error("Failed to parse tool state.json during aspect import", e.message)` and the equivalent for `memory.json`.
- **What This Enables:** Identifying *why* an import failed (syntax error vs. unexpected structure) instead of just that it failed.

### 3. [RESOLVED] Missing Error Context on Settings Fetch Error
- **Location:** `src/js/modules/settings.js`, `fetchProviderModels`.
- **Previous Blindness:** If the provider's error response body wasn't valid JSON (e.g. a proxy/gateway returning an HTML 502 page), the parse failure was swallowed by an empty `catch(e){}`, obscuring that a non-JSON error occurred.
- **Fix Applied:** `console.warn("Failed to parse error response JSON", e.message)` in the catch block.
- **What This Enables:** Tracing proxy/gateway failures that return HTML instead of the expected JSON error structure.
