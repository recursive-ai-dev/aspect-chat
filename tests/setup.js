import { vi } from 'vitest';
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom';
import { server } from './mocks/server.js';

// Start MSW Server
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Polyfill DOMMatrix for JSDOM
if (typeof global.DOMMatrix === 'undefined') {
    global.DOMMatrix = class DOMMatrix {
        constructor() {
            this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
        }
    };
}
