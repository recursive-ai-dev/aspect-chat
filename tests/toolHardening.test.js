import { describe, it, expect } from 'vitest';
import {
    hashToolCode, isToolTrusted, trustAllTools, aspectHasUntrustedTools,
    sanitizeToolName, RESERVED_TOOL_NAMES, normalizeAspect
} from '../src/js/modules/aspects.js';
import { parseToolCalls } from '../src/js/modules/tools.js';
import { resolveImportedToolNames } from '../src/js/modules/zip.js';

describe('per-tool trust (hash-keyed)', () => {
    it('a tool runs only while its code matches the reviewed hash', () => {
        const tool = { code: 'async function executeTool(){ return 1; }' };
        expect(isToolTrusted(tool)).toBe(false);
        tool.trustedHash = hashToolCode(tool.code);
        expect(isToolTrusted(tool)).toBe(true);
        tool.code += '\n// edited';
        expect(isToolTrusted(tool)).toBe(false);       // re-arms on any change
    });

    it('trustAllTools stamps every tool at its current code', () => {
        const aspect = { tools: [{ code: 'a' }, { code: 'b' }] };
        trustAllTools(aspect);
        expect(aspect.tools.every(isToolTrusted)).toBe(true);
        expect(aspectHasUntrustedTools(aspect)).toBe(false);
    });

    it('normalizeAspect grandfathers legacy trusted tools but not imported ones', () => {
        const legacy = normalizeAspect({ tools: [{ name: 'x.js', code: 'c' }] }); // toolsReviewed undefined
        expect(isToolTrusted(legacy.tools[0])).toBe(true);

        const imported = normalizeAspect({ toolsReviewed: false, tools: [{ name: 'x.js', code: 'c' }] });
        expect(isToolTrusted(imported.tools[0])).toBe(false);
    });

    it('adding a fresh tool to an already-trusted Aspect leaves it inert', () => {
        const aspect = { tools: [{ code: 'a' }] };
        trustAllTools(aspect);
        aspect.tools.push({ code: 'sneaky' });
        expect(aspectHasUntrustedTools(aspect)).toBe(true);
        expect(isToolTrusted(aspect.tools[1])).toBe(false);
    });
});

describe('sanitizeToolName', () => {
    it('restricts charset, strips leading dots, caps length, keeps .js', () => {
        expect(sanitizeToolName('../../etc/pw')).toBe('etcpw.js');
        expect(sanitizeToolName('my tool!!')).toBe('mytool.js');
        expect(sanitizeToolName('Weather.js')).toBe('Weather.js');
        expect(sanitizeToolName('')).toBe('tool.js');
        expect(sanitizeToolName('x'.repeat(200)).length).toBeLessThanOrEqual(64 + 3);
    });
});

describe('resolveImportedToolNames', () => {
    it('renames a tool that shadows a built-in system tool', () => {
        const tools = RESERVED_TOOL_NAMES.map(n => ({ name: n, code: 'evil' }));
        resolveImportedToolNames(tools);
        for (const t of tools) {
            expect(RESERVED_TOOL_NAMES.map(r => r.toLowerCase())).not.toContain(t.name.toLowerCase());
            expect(t.name.startsWith('imported_')).toBe(true);
        }
    });

    it('deduplicates colliding names', () => {
        const tools = [{ name: 'a.js', code: '1' }, { name: 'a.js', code: '2' }, { name: 'a.js', code: '3' }];
        resolveImportedToolNames(tools);
        expect(new Set(tools.map(t => t.name)).size).toBe(3);
    });
});

describe('parseToolCalls (balanced-paren scanner)', () => {
    it('keeps JSON args that contain ) ] and newlines', () => {
        const calls = parseToolCalls('[Run Tool: Fetch({"note": "see fig 1)", "list": [1,2]})]');
        expect(calls).toHaveLength(1);
        expect(JSON.parse(calls[0].args)).toEqual({ note: 'see fig 1)', list: [1, 2] });
    });

    it('handles a bare no-arg call and multiple calls in one message', () => {
        const calls = parseToolCalls('do [Run Tool: A] then [Run Tool: B({"x":1})] please');
        expect(calls.map(c => c.name)).toEqual(['A', 'B']);
        expect(calls[0].args).toBe('');
    });

    it('skips an unterminated call rather than swallowing the rest of the message', () => {
        const calls = parseToolCalls('[Run Tool: Broken({"x": 1  and more text with no close');
        expect(calls).toHaveLength(0);
    });
});
