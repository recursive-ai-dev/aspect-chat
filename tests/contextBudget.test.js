import { describe, expect, it } from 'vitest';
import { contextBudgetWarning, estimateRequestTokens } from '../src/js/modules/contextBudget.js';
describe('context budget', () => {
    it('accounts for UTF-8 and tool schema overhead', () => {
        const ascii = estimateRequestTokens([{ content: 'aaaa' }]);
        expect(estimateRequestTokens([{ content: '🔥🔥🔥🔥' }])).toBeGreaterThan(ascii);
        expect(estimateRequestTokens([{ content: 'aaaa' }], [{ function: { name: 'tool' } }])).toBeGreaterThan(ascii);
    });
    it('reserves response tokens and warns before clipping', () => {
        expect(contextBudgetWarning([{ content: 'x'.repeat(1500) }], { maxTokens: 512 }, 1024)).toContain('persona');
        expect(contextBudgetWarning([{ content: 'hi' }], { maxTokens: 100 }, 8192)).toBeNull();
    });
});
