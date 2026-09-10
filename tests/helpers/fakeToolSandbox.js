import { vi } from 'vitest';

/**
 * Test double for `runSandboxedTool` from src/js/modules/toolSandbox.js.
 *
 * jsdom creates <iframe> elements but never runs their srcdoc scripts, so the
 * real sandbox would just hang until timeout. This runs the tool code directly
 * while faithfully reproducing the message contract the sandbox exposes:
 *   - `self.postMessage({type:'writeMemory'|'summonAspect', …})` is routed to
 *     `onPrivileged(msg, post)`, and `post({type:'…Complete'})` is delivered
 *     back to listeners the tool registered with `self.addEventListener`.
 *   - `fetch(...)` is routed to `onNetwork(req)` and its `{ok,status,body,…}`
 *     reply is reconstructed into a `Response`.
 * Returns `{ result, state }` like the real thing.
 */
export const fakeRunSandboxedTool = vi.fn(async (opts) => {
    const { code, args, memory, onPrivileged, onNetwork } = opts;
    // The real sandbox gets a structured-clone copy of state over postMessage;
    // mirror that so the caller only sees mutations it explicitly adopts.
    const state = opts.state == null ? {} : JSON.parse(JSON.stringify(opts.state));

    const listeners = new Set();
    const deliver = (data) => {
        for (const fn of [...listeners]) fn({ data });
    };

    const self = {
        aspectMemory: memory || {},
        addEventListener: (type, fn) => { if (type === 'message') listeners.add(fn); },
        removeEventListener: (type, fn) => { if (type === 'message') listeners.delete(fn); },
        postMessage: (msg) => {
            if (msg && (msg.type === 'writeMemory' || msg.type === 'summonAspect' || msg.type === 'watchMemory')) {
                Promise.resolve(onPrivileged && onPrivileged(msg, deliver));
            }
        }
    };

    const sandboxFetch = async (input, init = {}) => {
        const url = typeof input === 'string' ? input : (input && input.url);
        const method = String(init.method || 'GET').toUpperCase();
        const res = await (onNetwork
            ? onNetwork({ url, method, headers: init.headers || {}, body: init.body })
            : { ok: false, error: 'Network disabled.' });
        if (!res.ok) throw new TypeError(res.error || 'Network request failed');
        return new Response(res.body, {
            status: res.status || 200,
            statusText: res.statusText || '',
            headers: res.headers || {}
        });
    };

    const runner = new Function('self', 'fetch', 'args', 'state', `
        "use strict";
        ${code}
        if (typeof executeTool !== 'function') {
            throw new Error("Function executeTool(args, state) is not defined in this script.");
        }
        return executeTool(args, state);
    `);

    const result = await runner(self, sandboxFetch, args, state);
    return { result, state };
});
