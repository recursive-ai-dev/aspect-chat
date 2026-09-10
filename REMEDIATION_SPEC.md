# REMEDIATION_SPEC.md: Technical Remediation & Architecture Fixes

This specification details the code-level fixes required to resolve security vulnerabilities, data integrity bugs, performance bottlenecks, and shell integration issues identified across the codebase.

---

### 1. Unified Tool Trust & Import Sanitization (F-01, F-02, F-07)

**Problem:**
`backup.js` and `persist.js` allow untrusted JSON imports to carry pre-trusted hashes (`trustedHash`) and pre-authorized network grants (`allowNetwork`, `allowedOrigins`), bypassing the security review gate that `.aspect` ZIP archives enforce. Additionally, `workflowBuilder.js` creates tools without computing their initial trust hash, leaving them silently inert while signaling success.

**Required Changes:**

* **`src/js/modules/persist.js` (`parseLibrary`)**:
Sanitize every tool in imported Aspects to only contain `{ name, code, state }`. Explicitly strip `trustedHash`, `allowNetwork`, and `allowedOrigins`. Enforce `toolsReviewed: false` if any tools are present.


```js
// src/js/modules/persist.js
export function sanitizeImportedAspect(rawAspect) {
  const hasTools = Array.isArray(rawAspect.tools) && rawAspect.tools.length > 0;
  const tools = (rawAspect.tools || []).map(tool => ({
    name: String(tool.name || 'UnnamedTool.js'),
    code: String(tool.code || ''),
    state: (tool.state && typeof tool.state === 'object') ? tool.state : {}
  }));

  return {
    ...rawAspect,
    tools,
    toolsReviewed: !hasTools
  };
}

```


* **`src/js/modules/backup.js` (`importAllAspects`)**:
Pipe all incoming Aspect objects through `sanitizeImportedAspect()` prior to passing them into `normalizeAspect()`.


* **`src/js/modules/workflowBuilder.js`**:
Compute and stamp `trustedHash` via `hashToolCode(compiledCode)` directly at the point of creation, since the user generated the code locally within the builder:
```js
// src/js/modules/workflowBuilder.js
import { hashToolCode } from './aspects.js';

aspect.tools.push({
  name: toolName,
  code: compiledCode,
  state: {},
  trustedHash: hashToolCode(compiledCode)
});

```



---

### 2. Batched IndexedDB Transactions for Knowledge Ingestion (F-03)

**Problem:**
`src/js/modules/db.js` sequentially opens and awaits an independent `readwrite` IndexedDB transaction for every extracted file/page chunk. For multi-page PDFs or multi-document imports, this adds massive browser transaction serialization overhead.

**Required Changes:**

* Implement `saveKnowledgeFileBatch(entries)` in `src/js/modules/db.js` to process multiple file chunks within a single transaction:
```js
// src/js/modules/db.js
export async function saveKnowledgeFileBatch(entries) {
  if (!entries || entries.length === 0) return;
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction('knowledge', 'readwrite');
    const store = tx.objectStore('knowledge');

    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();

    for (const entry of entries) {
      // Enforce deterministic compound keys: `${aspectId}:${filename}:${chunkIndex}`
      store.put(entry);
    }
  });
}

```


* Update `uploadKnowledgeFiles` to accumulate processed pages/text segments in an array and dispatch a single `saveKnowledgeFileBatch` call.

---

### 3. Tool Sandbox Channel Security & Lifecycle Hardening (F-04, F-05)

**Problem:**

* `randomChannel()` uses `Math.random().toString(36) + Date.now()` to authenticate parent-frame postMessage communications across opaque origin boundaries (`origin === "null"`).


* When an execution timeouts or aborts, `netWaiters` in `toolSandbox.js` are abandoned rather than rejected, leaking dangling promises.



**Required Changes:**

* **Cryptographic Nonce (`src/js/modules/toolSandbox.js`)**:
Replace pseudo-random generation with Web Crypto:
```js
const randomChannel = () => {
  return 'ch_' + (typeof crypto.randomUUID === 'function' 
    ? crypto.randomUUID() 
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join(''));
};

```


* **Teardown Promise Draining**:
Maintain a reference to active `netWaiters` Map and reject all entries on abort or teardown:
```js
// Inside executeToolSandbox()
const netWaiters = new Map();

const cleanup = () => {
  if (timer) clearTimeout(timer);
  window.removeEventListener('message', onMessage);
  if (onAbort && signal) signal.removeEventListener('abort', onAbort);

  // Drain pending brokered network promises
  for (const [seq, waiter] of netWaiters.entries()) {
    waiter.reject(new Error('Tool execution aborted or timed out during pending fetch'));
  }
  netWaiters.clear();

  if (iframe && iframe.parentNode) {
    iframe.parentNode.removeChild(iframe);
  }
  iframe = null;
};

```



---

### 4. Workflow Codegen Sanitization (F-06)

**Problem:**
Interpolating raw string variables directly into JavaScript templates via `${val}` inside `workflowBuilder.js` creates syntax errors or unintended code execution if inputs contain unescaped quotes, backslashes, or newlines.

**Required Changes:**

* **`src/js/modules/workflowBuilder.js`**:
Sanitize all user-controlled config strings using `JSON.stringify()` before injecting into code generation templates:


```js
// Replace:
// const url = "${urlVal}" || currentData.url || currentData;
// const key = "${keyVal}";

// With:
const urlLiteral = JSON.stringify(urlVal || '');
const keyLiteral = JSON.stringify(keyVal || '');

const compiledCode = `
  const url = ${urlLiteral} || currentData.url || currentData;
  const key = ${keyLiteral};
`;

```



---

### 5. Multibyte UTF-8 SSE Stream Termination (F-08)

**Problem:**
`readSSEStream` in `src/js/modules/llm.js` decodes incoming stream buffers with `{ stream: true }` in a loop, but omits a final `decoder.decode()` call without options upon stream completion. If the final chunk terminates on a multibyte sequence boundary (e.g., an emoji), the trailing bytes fail to flush or emit `U+FFFD`.

**Required Changes:**

* **`src/js/modules/llm.js`**:
```js
// Inside readSSEStream(response, onChunk, signal)
const reader = response.body.getReader();
const decoder = new TextDecoder('utf-8');
let pending = '';

try {
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });

    const lines = pending.split(/\r?\n/);
    pending = lines.pop(); // Retain remainder
    for (const line of lines) {
      consumeLine(line);
    }
  }

  // Flush any trailing multi-byte bytes held in decoder stream buffer
  pending += decoder.decode();
  if (pending.trim()) {
    consumeLine(pending);
  }
} finally {
  reader.releaseLock();
}

```



---

### 6. Desktop Launcher Bash Syntax Fixes (F-09)

**Problem:**
`desktop/aspect-chat-install.sh` writes out a wrapper script via a heredoc (`cat > "${LAUNCHER}" <<'EOF'`), but several internal shell functions (`server_running`, `server_healthy`, `stop_server`) omit closing braces `}`. This causes parse failures on launcher execution.

**Required Changes:**

* Fix function closure syntax in `desktop/aspect-chat-install.sh`:
```bash
server_running() {
    [ -f "${PID_FILE}" ] || return 1
    local pid
    pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
    [ -n "${pid}" ] && kill -0 "${pid}" 2>/dev/null
}

server_healthy() {
    if command -v curl >/dev/null 2>&1; then
        local code
        code="$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 1 "http://127.0.0.1:${PORT}/" 2>/dev/null || true)"
        [ "${code}" = "200" ] || [ "${code}" = "304" ]
    else
        port_open
    fi
}

stop_server() {
    if command -v systemctl >/dev/null 2>&1 && systemctl --user is-active --quiet aspect-chat 2>/dev/null; then
        systemctl --user stop aspect-chat 2>/dev/null || true
    fi
    if [ -f "${PID_FILE}" ]; then
        local pid
        pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
        if [ -n "${pid}" ]; then
            kill -TERM "${pid}" 2>/dev/null || true
            for _ in $(seq 1 20); do
                kill -0 "${pid}" 2>/dev/null || break
                sleep 0.2
            done
            kill -KILL "${pid}" 2>/dev/null || true
        fi
        rm -f "${PID_FILE}"
    fi
    if port_open && command -v fuser >/dev/null 2>&1; then
        fuser -k "${PORT}/tcp" 2>/dev/null || true
        sleep 0.2
    fi
}

```



---

### 7. Implementation Checklist

* [ ] Add `sanitizeImportedAspect` to `persist.js` and call it in `backup.js`.


* [ ] Add `saveKnowledgeFileBatch` to `db.js` and refactor `uploadKnowledgeFiles`.


* [ ] Replace `randomChannel` token generation with `crypto.randomUUID()` in `toolSandbox.js`.


* [ ] Drain `netWaiters` in `toolSandbox.js:cleanup()`.


* [ ] Wrap config literals with `JSON.stringify()` in `workflowBuilder.js`.


* [ ] Add `trustedHash` stamping to `save-workflow` action in `workflowBuilder.js`.


* [ ] Add final `decoder.decode()` flush to `llm.js`.


* [ ] Patch syntax function closures in `desktop/aspect-chat-install.sh`.
