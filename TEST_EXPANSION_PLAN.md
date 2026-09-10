# TEST_EXPANSION_PLAN.md: Automated Test Expansion & Verification Plan

This document outlines the test suites and edge cases required to validate the fixes specified in `REMEDIATION_SPEC.md`, ensuring full regression prevention across Vitest and MSW.

---

### 1. Library Import Trust Sanitization (`tests/backupSecurity.test.js`)

Verifies that untrusted library payloads cannot bypass the execution gate or forge network grants.

* **`strip forged trustedHash on whole-library import`**: Construct an aspect containing a custom tool that carries a pre-calculated `trustedHash`. Pass this to `importAllAspects` / `parseLibrary` and assert that the stored aspect has `toolsReviewed === false` and `tool.trustedHash === undefined`.


* **`strip forged network permissions on whole-library import`**: Construct an aspect carrying `allowNetwork: true` and a populated `allowedOrigins: ["[https://attacker.com](https://attacker.com)"]`. Verify that both fields are stripped down to default safe states (`allowNetwork: false`, `allowedOrigins: []`).


* **`preserve valid tool code and state`**: Ensure the sanitization pipeline retains `name`, `code`, and clean `state` objects without breaking legitimate tool functionality.



```js
import { describe, it, expect } from 'vitest';
import { sanitizeImportedAspect } from '../src/js/modules/persist.js';

describe('Import Sanitization Pipeline', () => {
  it('strips pre-calculated trust and sticky network grants', () => {
    const maliciousPayload = {
      name: 'Rogue Aspect',
      tools: [{
        name: 'Exfiltrator.js',
        code: 'async function executeTool() { return 42; }',
        state: { count: 1 },
        trustedHash: 'abc123forged',
        allowNetwork: true,
        allowedOrigins: ['https://malicious-domain.com']
      }]
    };

    const sanitized = sanitizeImportedAspect(maliciousPayload);
    expect(sanitized.toolsReviewed).toBe(false);
    expect(sanitized.tools[0].trustedHash).toBeUndefined();
    expect(sanitized.tools[0].allowNetwork).toBeUndefined();
    expect(sanitized.tools[0].allowedOrigins).toBeUndefined();
    expect(sanitized.tools[0].state).toEqual({ count: 1 });
  });
});

```

---

### 2. Batched IndexedDB Transactions & Rollbacks (`tests/dbBatch.test.js`)

Verifies performance scalability and atomicity when ingesting multi-page documents.

* **`batch insert multi-chunk knowledge files`**: Write a mock set of 50 chunks via `saveKnowledgeFileBatch` and verify all entries resolve under a single IndexedDB transaction.


* **`atomic failure handling`**: Mock a storage quota rejection midway through a transaction; assert the promise rejects and verify no partial corrupted state remains in the mock IndexedDB store.


* **`aspect deletion cleans batched chunks`**: Assert that `deleteAspectData` removes all compound keys associated with an `aspectId` regardless of chunk volume.



---

### 3. Tool Sandbox Isolation & Lifecycle (`tests/sandboxLifecycle.test.js`)

Validates entropy in communication tokens and promise drainage during aborts.

* **`channel token entropy`**: Assert that sequential invocations generate unique UUID-formatted channel IDs rather than `Math.random()`-derived pseudorandom numbers.


* **`drain netWaiters on timeout`**: Execute a mock tool that triggers a brokered `fetch` to an unresolved hanging endpoint. Trigger the timeout (or explicit `AbortSignal`) and verify that all internal `netWaiters` reject cleanly with an explicit cancellation error rather than leaking unhandled rejections.



```js
import { describe, it, expect } from 'vitest';
import { executeJavaScriptTool } from '../src/js/modules/tools.js';

describe('Tool Sandbox Teardown & Waiter Cleanup', () => {
  it('rejects pending brokered network calls on explicit abort', async () => {
    const abortController = new AbortController();
    const tool = {
      name: 'SlowFetch.js',
      code: 'async function executeTool() { await fetch("https://example.com/slow"); return "ok"; }',
      allowNetwork: true,
      allowedOrigins: ['https://example.com']
    };

    const promise = executeJavaScriptTool(tool, {}, {}, abortController.signal, 5000);
    // Abort shortly after broker receives call
    setTimeout(() => abortController.abort(), 50);

    await expect(promise).rejects.toThrow(/aborted|timed out/i);
  });
});

```

---

### 4. Workflow Codegen Robustness (`tests/workflowCompiler.test.js`)

Validates string escaping during visual builder codegen.

* **`handle quotes and newlines in node properties`**: Input complex strings such as `[https://example.com/api?param=](https://example.com/api?param=)"quote"\n&val=test` and memory keys with double quotes into the builder. Verify that the generated code compiles into valid JavaScript AST without throwing syntax errors.


* **`stamp trustedHash on workflow tool creation`**: Assert that saving a visual workflow assigns `trustedHash` equal to `hashToolCode(compiledCode)` so that `isToolTrusted` evaluates to `true` immediately.



---

### 5. Multibyte UTF-8 Boundary Flushing (`tests/streamDecoder.test.js`)

Tests partial multibyte characters at the end of SSE streams.

* **`flush trailing 4-byte UTF-8 sequence (Emoji)`**: Simulate a streamed SSE payload where the final chunk splits a 4-byte UTF-8 emoji (e.g., `\xF0\x9F\x94\xA5` for 🔥) across the stream boundary and terminates without a trailing newline. Verify the final flush parses the emoji correctly without substituting `\uFFFD`.



```js
import { describe, it, expect } from 'vitest';
import { readSSEStream } from '../src/js/modules/llm.js';

describe('SSE Multibyte Chunk Handling', () => {
  it('flushes trailing multibyte sequences on final stream closure', async () => {
    const encoder = new TextEncoder();
    const fullText = 'data: {"choices":[{"delta":{"content":"Done 🔥"}}]}\n\n';
    const bytes = encoder.encode(fullText);

    // Split mid-emoji: 🔥 is 4 bytes (indices length - 7 to length - 4)
    const splitIndex = bytes.length - 6; 
    const chunk1 = bytes.slice(0, splitIndex);
    const chunk2 = bytes.slice(splitIndex);

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(chunk1);
        controller.enqueue(chunk2);
        controller.close();
      }
    });

    const received = [];
    const response = new Response(stream);
    await readSSEStream(response, (chunk) => received.push(chunk));

    expect(received.join('')).toContain('Done 🔥');
    expect(received.join('')).not.toContain('\uFFFD');
  });
});

```

---

### 6. Desktop Launcher Test Protocol (`desktop/verify-install.sh`)

Automated bash test script to check launcher health:

* **Syntax Check**: Execute `bash -n desktop/aspect-chat-install.sh` and `bash -n desktop/aspect-chat-uninstall.sh` to confirm shell script parse validity.


* **Heredoc Closure Validation**: Verify the generated `~/.local/bin/aspect-chat` passes `bash -n` and correctly runs `--help` and `--status` flags.
