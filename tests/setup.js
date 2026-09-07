import { vi } from 'vitest';
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom';
import { server } from './mocks/server.js';

// Start MSW Server
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Web Storage in the test env.
// Node 22+ ships an experimental `localStorage`/`sessionStorage` global that is
// inert unless the process is started with `--localstorage-file`; under Vitest 4
// it shadows the working implementation jsdom puts on `window`, so tests that do
// `localStorage.clear()` see `undefined`. Re-point the globals at jsdom's, and
// fall back to a tiny in-memory Storage if jsdom didn't provide one.
function memoryStorage() {
    let map = new Map();
    return {
        get length() { return map.size; },
        key: i => [...map.keys()][i] ?? null,
        getItem: k => (map.has(String(k)) ? map.get(String(k)) : null),
        setItem: (k, v) => { map.set(String(k), String(v)); },
        removeItem: k => { map.delete(String(k)); },
        clear: () => { map = new Map(); }
    };
}
for (const name of ['localStorage', 'sessionStorage']) {
    let impl;
    try { impl = global.window && global.window[name]; } catch { impl = undefined; }
    if (!impl || typeof impl.clear !== 'function') impl = memoryStorage();
    Object.defineProperty(global, name, { value: impl, configurable: true, writable: true });
    if (global.window) {
        Object.defineProperty(global.window, name, { value: impl, configurable: true, writable: true });
    }
}

// Polyfill DOMMatrix for JSDOM
if (typeof global.DOMMatrix === 'undefined') {
    global.DOMMatrix = class DOMMatrix {
        constructor() {
            this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
        }
    };
}
