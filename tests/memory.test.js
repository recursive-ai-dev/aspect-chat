/**
 * Tests for Track 3: Enhanced memory
 *  - getMemoryNamespace / listMemoryKeys helpers (db.js)
 *  - Ephemeral keys (~prefix) skipping IndexedDB writes (tools.js)
 *  - Memory event listeners / MemoryWatch (tools.js)
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getMemoryNamespace, listMemoryKeys } from '../src/js/modules/db.js';

// ─── Mocks required by tools.js transitive imports ───────────────────────────

vi.mock('../src/js/modules/toolSandbox.js', async () => ({
    runSandboxedTool: (await import('./helpers/fakeToolSandbox.js')).fakeRunSandboxedTool,
}));

vi.mock('../src/js/modules/aspects.js', async (orig) => ({
    ...(await orig()),
    getCurrentAspect: vi.fn(),
}));

vi.mock('../src/js/modules/ui.js', () => ({
    markChangesUnsaved: vi.fn(),
    setChatLoadingState: vi.fn(),
    renderConversationList: vi.fn(),
}));

vi.mock('../src/js/modules/chat.js', () => ({
    renderChatMessages: vi.fn(),
    createStreamingBubble: vi.fn().mockReturnValue({}),
    updateStreamingBubble: vi.fn(),
}));

vi.mock('../src/js/modules/db.js', async (orig) => ({
    ...(await orig()),
    saveMemory: vi.fn().mockResolvedValue(undefined),
}));

// ─── 1. getMemoryNamespace ────────────────────────────────────────────────────

describe('getMemoryNamespace', () => {
    const memory = {
        'projects/myapp/todos': [1, 2, 3],
        'projects/myapp/notes': 'hello',
        'projects/other/data': 42,
        'topLevel': 'yes',
        '~ephemeral': 'session',
    };

    it('returns keys under prefix with prefix stripped', () => {
        const result = getMemoryNamespace(memory, 'projects/myapp');
        expect(result).toEqual({ todos: [1, 2, 3], notes: 'hello' });
    });

    it('does not include sibling namespaces', () => {
        const result = getMemoryNamespace(memory, 'projects/myapp');
        expect(result).not.toHaveProperty('projects/other/data');
        expect(result).not.toHaveProperty('data');
    });

    it('prefix with trailing slash works the same way', () => {
        const result = getMemoryNamespace(memory, 'projects/myapp/');
        expect(result).toEqual({ todos: [1, 2, 3], notes: 'hello' });
    });

    it('returns empty object for unknown prefix', () => {
        expect(getMemoryNamespace(memory, 'unknown')).toEqual({});
    });

    it('returns empty object for null memory', () => {
        expect(getMemoryNamespace(null, 'projects')).toEqual({});
    });

    it('returns empty object for empty prefix', () => {
        expect(getMemoryNamespace(memory, '')).toEqual({});
    });

    it('does not include top-level keys when prefix does not match', () => {
        const result = getMemoryNamespace(memory, 'projects/myapp');
        expect(result).not.toHaveProperty('topLevel');
    });
});

// ─── 2. listMemoryKeys ────────────────────────────────────────────────────────

describe('listMemoryKeys', () => {
    const memory = {
        'projects/myapp/todos': [],
        'projects/other/data': 1,
        'topLevel': 'yes',
        '~ephemeral': 'session',
        'aardvark': 0,
    };

    it('returns all keys sorted when no prefix given', () => {
        const keys = listMemoryKeys(memory);
        expect(keys).toEqual([
            'aardvark',
            'projects/myapp/todos',
            'projects/other/data',
            'topLevel',
            '~ephemeral',
        ]);
        // Verify sorted (each element <= the next in locale comparison)
        for (let i = 0; i < keys.length - 1; i++) {
            expect(keys[i] <= keys[i + 1]).toBe(true);
        }
    });

    it('filters by prefix when provided', () => {
        const keys = listMemoryKeys(memory, 'projects/');
        expect(keys).toEqual(['projects/myapp/todos', 'projects/other/data']);
    });

    it('returns empty array for null memory', () => {
        expect(listMemoryKeys(null)).toEqual([]);
    });

    it('returns empty array for non-matching prefix', () => {
        expect(listMemoryKeys(memory, 'nonexistent/')).toEqual([]);
    });
});

describe('privileged memory writes through a sandbox', () => {
    beforeEach(() => vi.clearAllMocks());
    it.each(['~session', 'durable'])('writes %s and persists only durable keys', async key => {
        const { executeJavaScriptTool } = await import('../src/js/modules/tools.js');
        const { getCurrentAspect, hashToolCode } = await import('../src/js/modules/aspects.js');
        const { saveMemory } = await import('../src/js/modules/db.js');
        const code = `async function executeTool(args) {
            return new Promise(resolve => {
                self.addEventListener('message', event => {
                    if (event.data.type === 'memoryWriteComplete') resolve(event.data);
                });
                self.postMessage({ type: 'writeMemory', key: args.key, value: 42, messageId: 'm1' });
            });
        }`;
        const aspect = { id: 'memory-write', memory: {}, chatHistory: [], tools: [
            { name: 'Writer.js', code, state: {}, trustedHash: hashToolCode(code) }
        ] };
        getCurrentAspect.mockReturnValue(aspect);
        const result = JSON.parse(await executeJavaScriptTool('Writer.js', JSON.stringify({ key })));
        expect(result.type).toBe('memoryWriteComplete');
        expect(aspect.memory[key]).toBe(42);
        if (key.startsWith('~')) expect(saveMemory).not.toHaveBeenCalled();
        else expect(saveMemory).toHaveBeenCalledWith(aspect.id, { [key]: 42 });
    });
});

// ─── 4. systemTools: MemoryWatch.js present ───────────────────────────────────

describe('systemTools registry', () => {
    it('includes MemoryWatch.js', async () => {
        const { systemTools } = await import('../src/js/modules/systemTools.js');
        const names = systemTools.map(t => t.name);
        expect(names).toContain('MemoryWatch.js');
    });

    it('ReadMemory.js supports namespace and list args in description/code', async () => {
        const { systemTools } = await import('../src/js/modules/systemTools.js');
        const rm = systemTools.find(t => t.name === 'ReadMemory.js');
        expect(rm).toBeDefined();
        expect(rm.code).toContain('args.namespace');
        expect(rm.code).toContain('args.list');
    });

    it('WriteMemory.js supports ephemeral arg in code', async () => {
        const { systemTools } = await import('../src/js/modules/systemTools.js');
        const wm = systemTools.find(t => t.name === 'WriteMemory.js');
        expect(wm).toBeDefined();
        expect(wm.code).toContain('ephemeral');
        expect(wm.code).toContain("startsWith('~')");
    });

    it('MemoryWatch.js code sends watchMemory message', async () => {
        const { systemTools } = await import('../src/js/modules/systemTools.js');
        const mw = systemTools.find(t => t.name === 'MemoryWatch.js');
        expect(mw).toBeDefined();
        expect(mw.code).toContain("type: 'watchMemory'");
        expect(mw.code).toContain('memoryWatchComplete');
    });

    it('all original tools still present', async () => {
        const { systemTools } = await import('../src/js/modules/systemTools.js');
        const names = systemTools.map(t => t.name);
        expect(names).toContain('Calculator.js');
        expect(names).toContain('Weather.js');
        expect(names).toContain('DateTime.js');
        expect(names).toContain('ReadMemory.js');
        expect(names).toContain('WriteMemory.js');
        expect(names).toContain('SummonAspect.js');
    });
});
