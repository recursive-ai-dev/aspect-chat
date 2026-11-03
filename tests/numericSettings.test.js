import { describe, it, expect, afterEach, vi } from 'vitest';
import { normalizeNumericSetting } from '../src/js/modules/numericSettings.js';

describe('numeric settings bounds', () => {
    it.each([
        ['maxContext', -3, 1], ['maxContext', 999, 500], ['maxContext', 3.9, 3],
        ['maxContext', 0, 1], ['maxContext', '', 20], ['maxContext', '12oops', 20],
        ['toolTimeoutMs', 2147483648, 600000], ['toolTimeoutMs', -5, 1000],
        ['toolTimeoutMs', Infinity, 30000], ['maxKnowledgeChars', 1e10, 5000000],
        ['retrievalTopK', -1, 1], ['contextTokens', NaN, 8192]
    ])('normalizes %s input %s to %s', (key, input, expected) => {
        expect(normalizeNumericSetting(key, input)).toBe(expected);
    });
});


describe('persisted numeric setting recovery', () => {
    afterEach(() => { localStorage.clear(); sessionStorage.clear(); });
    it('normalizes malformed persisted values before startup consumers see them', async () => {
        localStorage.setItem('maxContext', '-5');
        localStorage.setItem('toolTimeoutMs', '9999999999');
        localStorage.setItem('maxKnowledgeChars', 'not a number');
        vi.resetModules();
        const { state } = await import('../src/js/modules/state.js');
        expect(state.settings.maxContext).toBe(1);
        expect(state.settings.toolTimeoutMs).toBe(600000);
        expect(state.settings.maxKnowledgeChars).toBe(100000);
    });
});
