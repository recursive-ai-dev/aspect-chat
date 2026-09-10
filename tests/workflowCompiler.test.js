/**
 * tests/workflowCompiler.test.js
 *
 * Verifies F-06 and F-07 remediations:
 *  F-06 — All user-controlled config strings are JSON.stringify-escaped before
 *          injection into generated code, preventing syntax errors and code
 *          injection from quotes, backslashes, or newlines.
 *  F-07 — saveWorkflowAsTool stamps trustedHash so the resulting tool is
 *          immediately trusted and runnable without a manual editor review.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    compileWorkflow,
    saveWorkflowAsTool,
    addWorkflowNode,
    resetWorkflowStateForTesting
} from '../src/js/modules/workflowBuilder.js';
import { hashToolCode } from '../src/js/modules/aspects.js';

vi.mock('../src/js/modules/aspects.js', async (importOriginal) => {
    // Keep the real hashToolCode and isToolTrusted so F-07 assertions work.
    const real = await importOriginal();
    return {
        ...real,
        getCurrentAspect: vi.fn(),
        updateAspectData: vi.fn(),
        sanitizeToolName: vi.fn((n) => n.trim().replace(/[^a-zA-Z0-9._-]/g, '_')),
        RESERVED_TOOL_NAMES: ['Calculator.js']
    };
});

vi.mock('../src/js/modules/ui.js', () => ({
    markChangesUnsaved: vi.fn(),
    showToast: vi.fn()
}));

import * as aspects from '../src/js/modules/aspects.js';
import * as ui from '../src/js/modules/ui.js';

function makeNodes(...types) {
    const nodes = [];
    let prev = null;
    for (const type of types) {
        nodes.push({
            id: type + '_' + nodes.length,
            type,
            inputs: type === 'start' ? [] : ['Input'],
            outputs: ['Next']
        });
        prev = nodes[nodes.length - 1];
    }
    return nodes;
}

function makeConnections(nodesList) {
    return nodesList.slice(0, -1).map((n, i) => ({
        from: n.id,
        to: nodesList[i + 1].id
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
describe('F-06 — Workflow codegen escaping', () => {
    it('generates syntactically valid JS when fetch URL contains double quotes', () => {
        const nodes = makeNodes('start', 'fetch');
        const conns = makeConnections(nodes);
        const urlWithQuotes = 'https://example.com/api?param="quoted"&other=value';

        const configGetter = (id, field) => field === 'url' ? urlWithQuotes : '';
        const result = compileWorkflow(nodes, conns, configGetter);

        expect(result.success).toBe(true);
        // Must not contain a raw unescaped double-quoted string injection.
        // JSON.stringify wraps the value in balanced quotes with internal escaping.
        expect(result.code).toContain(JSON.stringify(urlWithQuotes));
        // The generated code must parse as valid JS.
        expect(() => new Function(result.code)).not.toThrow();
    });

    it('generates syntactically valid JS when fetch URL contains single quotes', () => {
        const nodes = makeNodes('start', 'fetch');
        const conns = makeConnections(nodes);
        const urlWithSingleQuotes = "https://example.com/api?q=it's+a+test";

        const result = compileWorkflow(nodes, conns, (_, field) =>
            field === 'url' ? urlWithSingleQuotes : ''
        );

        expect(result.success).toBe(true);
        expect(result.code).toContain(JSON.stringify(urlWithSingleQuotes));
        expect(() => new Function(result.code)).not.toThrow();
    });

    it('generates syntactically valid JS when fetch URL contains newlines', () => {
        const nodes = makeNodes('start', 'fetch');
        const conns = makeConnections(nodes);
        const urlWithNewlines = 'https://example.com/\ninjected\n';

        const result = compileWorkflow(nodes, conns, (_, field) =>
            field === 'url' ? urlWithNewlines : ''
        );

        expect(result.success).toBe(true);
        expect(result.code).toContain(JSON.stringify(urlWithNewlines));
        expect(() => new Function(result.code)).not.toThrow();
    });

    it('generates syntactically valid JS when fetch URL contains backslashes', () => {
        const nodes = makeNodes('start', 'fetch');
        const conns = makeConnections(nodes);
        const urlWithBackslash = 'https://example.com/path\\n\\t?q=test';

        const result = compileWorkflow(nodes, conns, (_, field) =>
            field === 'url' ? urlWithBackslash : ''
        );

        expect(result.success).toBe(true);
        expect(result.code).toContain(JSON.stringify(urlWithBackslash));
        expect(() => new Function(result.code)).not.toThrow();
    });

    it('generates syntactically valid JS when memory key contains double quotes', () => {
        const nodes = makeNodes('start', 'memory');
        const conns = makeConnections(nodes);
        const keyWithQuotes = 'my "special" key';

        const result = compileWorkflow(nodes, conns, (_, field) =>
            field === 'key' ? keyWithQuotes : ''
        );

        expect(result.success).toBe(true);
        expect(result.code).toContain(JSON.stringify(keyWithQuotes));
        expect(() => new Function(result.code)).not.toThrow();
    });

    it('generates syntactically valid JS when memory key contains newlines', () => {
        const nodes = makeNodes('start', 'memory');
        const conns = makeConnections(nodes);
        const keyWithNewlines = 'key\nwith\nnewlines';

        const result = compileWorkflow(nodes, conns, (_, field) =>
            field === 'key' ? keyWithNewlines : ''
        );

        expect(result.success).toBe(true);
        expect(result.code).toContain(JSON.stringify(keyWithNewlines));
        expect(() => new Function(result.code)).not.toThrow();
    });

    it('generates syntactically valid JS when regex contains special chars', () => {
        const nodes = makeNodes('start', 'extract');
        const conns = makeConnections(nodes);
        const regex = '<title>(.*?)<\\/title>';

        const result = compileWorkflow(nodes, conns, (_, field) =>
            field === 'regex' ? regex : ''
        );

        expect(result.success).toBe(true);
        expect(() => new Function(result.code)).not.toThrow();
    });

    it('generates syntactically valid JS from a complex multi-node workflow', () => {
        const nodes = [
            { id: 'start', type: 'start', inputs: [], outputs: ['Next'] },
            { id: 'fetch', type: 'fetch', inputs: ['Trigger'], outputs: ['Next'] },
            { id: 'mem',   type: 'memory', inputs: ['Value'], outputs: ['Next'] }
        ];
        const conns = [
            { from: 'start', to: 'fetch' },
            { from: 'fetch', to: 'mem' }
        ];
        const configs = {
            fetch: { url: 'https://api.example.com/data?x="1"&y=\'2\'' },
            mem:   { key: 'result\nkey' }
        };

        const result = compileWorkflow(nodes, conns, (id, field) => configs[id]?.[field] ?? '');

        expect(result.success).toBe(true);
        expect(() => new Function(result.code)).not.toThrow();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('F-07 — trustedHash stamped on workflow tool creation', () => {
    beforeEach(() => {
        resetWorkflowStateForTesting();
        window.showToast = vi.fn();
        document.body.innerHTML = `
            <div id="workflow-modal" class="hidden"></div>
            <div id="workflow-nodes-container"></div>
            <input type="text" id="workflow-name-input" />
            <svg id="workflow-lines"></svg>
            <div id="workflow-canvas"></div>
        `;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('stamps trustedHash equal to hashToolCode(compiledCode) on new tool creation', () => {
        const mockAspect = { tools: [] };
        aspects.getCurrentAspect.mockReturnValue(mockAspect);
        document.getElementById('workflow-name-input').value = 'MyWorkflow';
        addWorkflowNode('start');

        saveWorkflowAsTool();

        expect(mockAspect.tools.length).toBe(1);
        const tool = mockAspect.tools[0];
        expect(tool.trustedHash).toBeDefined();
        expect(tool.trustedHash).toBe(hashToolCode(tool.code));
    });

    it('isToolTrusted returns true for a freshly created workflow tool', () => {
        const { isToolTrusted } = aspects;
        const mockAspect = { tools: [] };
        aspects.getCurrentAspect.mockReturnValue(mockAspect);
        document.getElementById('workflow-name-input').value = 'TrustCheck';
        addWorkflowNode('start');

        saveWorkflowAsTool();

        const tool = mockAspect.tools[0];
        expect(isToolTrusted(tool)).toBe(true);
    });

    it('re-stamps trustedHash when an existing workflow tool is overwritten', () => {
        const existingCode = '// old code';
        const existingHash = hashToolCode(existingCode);
        const mockAspect = {
            tools: [{
                name: 'UpdateMe.js',
                code: existingCode,
                trustedHash: existingHash
            }]
        };
        aspects.getCurrentAspect.mockReturnValue(mockAspect);
        document.getElementById('workflow-name-input').value = 'UpdateMe';
        addWorkflowNode('start');

        saveWorkflowAsTool();

        const tool = mockAspect.tools[0];
        // The code was regenerated, so the hash must match the NEW code.
        expect(tool.trustedHash).toBe(hashToolCode(tool.code));
        // And it should differ from the old hash since the code changed.
        expect(tool.trustedHash).not.toBe(existingHash);
    });

    it('shows a success toast that does NOT say "enable it before it can run"', () => {
        const mockAspect = { tools: [] };
        aspects.getCurrentAspect.mockReturnValue(mockAspect);
        document.getElementById('workflow-name-input').value = 'ReadyTool';
        addWorkflowNode('start');

        saveWorkflowAsTool();

        const toastCall = ui.showToast.mock.calls[0];
        expect(toastCall[0]).not.toMatch(/enable it before/i);
        expect(toastCall[0]).toMatch(/saved/i);
    });

    it('new workflow tool object has a state field initialised to {}', () => {
        const mockAspect = { tools: [] };
        aspects.getCurrentAspect.mockReturnValue(mockAspect);
        document.getElementById('workflow-name-input').value = 'StateCheck';
        addWorkflowNode('start');

        saveWorkflowAsTool();

        expect(mockAspect.tools[0].state).toEqual({});
    });
});
