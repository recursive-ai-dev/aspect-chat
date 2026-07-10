import { describe, it, expect, vi } from 'vitest';
import { executeJavaScriptTool } from '../src/js/modules/tools.js';
import * as aspects from '../src/js/modules/aspects.js';

vi.mock('../src/js/modules/aspects.js', () => ({
    getCurrentAspect: vi.fn()
}));

describe('executeJavaScriptTool', () => {
    it('should return error JSON if tool is not found', async () => {
        aspects.getCurrentAspect.mockReturnValue({
            tools: [{ name: 'existingTool' }]
        });

        const result = await executeJavaScriptTool('missingTool', '{}');
        expect(result).toBe(JSON.stringify({ error: 'Tool "missingTool" not found.' }));
    });
});
