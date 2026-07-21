### 1. Silent Failure Paths - Swallowed JSON parsing error during streaming
- **Location:** `src/js/modules/tools.js` lines 78, 97
- **Current Blindness:** When the LLM provider streams malformed JSON in a delta update, it is silently ignored. In production, if a specific provider model starts returning consistently malformed SSE chunks (causing the stream to halt or corrupt), there is zero log output indicating the failure.
- **Instrumentation Added:** Added a warning log `console.warn("Failed to parse SSE JSON chunk", e.message, dataStr)` in the empty catch blocks in `handleStreamResponse`.
- **What This Enables:** Detect provider-specific streaming formatting bugs and track the frequency of malformed chunks across models without breaking the stream parsing loop for expected partials.

### 2. Silent Failure Paths - Missing Error Context on Zip State Parse Failure
- **Location:** `src/js/modules/zip.js` line 141 (and memory parse at line 167)
- **Current Blindness:** When importing an `.aspect` file, if the `state.json` or `memory.json` is corrupted, the application logs "Failed to parse tool state.json" but drops the underlying error and context (which file/aspect caused it).
- **Instrumentation Added:** Updated `console.error` to include the raw error message and file path context: `console.error("Failed to parse tool state.json during aspect import", e.message)`.
- **What This Enables:** Identifies *why* the parse failed (e.g. syntax error vs undefined) during an import failure.

### 3. Silent Failure Paths - Missing Error Context on Settings Fetch Error
- **Location:** `src/js/modules/settings.js` line 69
- **Current Blindness:** In `fetchProviderModels`, if the initial API response is not OK, it attempts to parse the error JSON. If that parse fails (empty catch block), the original network error text is obscured, making it impossible to debug non-JSON error responses (like 502 Bad Gateway HTML pages).
- **Instrumentation Added:** Logged the failed JSON parsing error in the catch block: `console.warn("Failed to parse error response JSON", e.message);` to preserve the context that a non-JSON error occurred.
- **What This Enables:** Allows tracing of proxy/gateway errors that return HTML instead of the expected JSON structure when fetching models.
