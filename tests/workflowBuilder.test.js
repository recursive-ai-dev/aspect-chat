import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    compileWorkflow,
    saveWorkflowAsTool,
    addWorkflowNode,
    resetWorkflowStateForTesting
} from '../src/js/modules/workflowBuilder.js';
import * as aspects from '../src/js/modules/aspects.js';
import * as ui from '../src/js/modules/ui.js';

vi.mock('../src/js/modules/aspects.js', () => ({
    getCurrentAspect: vi.fn(),
    updateAspectData: vi.fn(),
    sanitizeToolName: vi.fn((n) => n.trim().replace(/[^a-zA-Z0-9._-]/g, '_')),
    RESERVED_TOOL_NAMES: ['Calculator.js'],
    // hashToolCode must be provided since saveWorkflowAsTool calls it (F-07).
    hashToolCode: vi.fn((code) => {
        // Minimal FNV-1a stand-in — deterministic enough for test assertions.
        let h = 0x811c9dc5;
        for (let i = 0; i < code.length; i++) {
            h ^= code.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
        return (h >>> 0).toString(16);
    })
}));

vi.mock('../src/js/modules/ui.js', () => ({
    markChangesUnsaved: vi.fn(),
    showToast: vi.fn()
}));

describe('workflowBuilder.js - Visual Workflow Builder and Compiler', () => {
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

    describe('compileWorkflow', () => {
        it('should return error if start node is missing', () => {
            const nodes = [{ id: 'fetch_1', type: 'fetch' }];
            const connections = [];
            const result = compileWorkflow(nodes, connections);
            expect(result.success).toBe(false);
            expect(result.error).toBe('Start node missing.');
        });

        it('should detect cycles in workflow connections and return error', () => {
            const nodes = [
                { id: 'start_1', type: 'start' },
                { id: 'fetch_1', type: 'fetch' }
            ];
            // start -> fetch -> start (cycle)
            const connections = [
                { from: 'start_1', to: 'fetch_1' },
                { from: 'fetch_1', to: 'start_1' }
            ];
            const result = compileWorkflow(nodes, connections);
            expect(result.success).toBe(false);
            expect(result.error).toContain('Cycle detected');
        });

        it('should fail compilation if extract node contains invalid regex', () => {
            const nodes = [
                { id: 'start_1', type: 'start' },
                { id: 'ext_1', type: 'extract' }
            ];
            const connections = [{ from: 'start_1', to: 'ext_1' }];
            const configGetter = (id, field) => {
                if (field === 'regex') return '[unclosed-regex';
                return '';
            };

            const result = compileWorkflow(nodes, connections, configGetter);
            expect(result.success).toBe(false);
            expect(result.error).toContain('Invalid regular expression in Extract node');
        });

        it('should compile a full linear flow into valid JavaScript code', () => {
            const nodes = [
                { id: 'start_1', type: 'start' },
                { id: 'fetch_1', type: 'fetch' },
                { id: 'ext_1', type: 'extract' },
                { id: 'mem_1', type: 'memory' },
                { id: 'cust_1', type: 'custom' }
            ];
            const connections = [
                { from: 'start_1', to: 'fetch_1' },
                { from: 'fetch_1', to: 'ext_1' },
                { from: 'ext_1', to: 'mem_1' },
                { from: 'mem_1', to: 'cust_1' }
            ];
            const configs = {
                fetch_1: { url: 'https://example.com/api' },
                ext_1: { regex: 'title>(.*?)<' },
                mem_1: { key: 'page_title' },
                cust_1: { code: 'return input.toUpperCase();' }
            };
            const configGetter = (id, field) => configs[id]?.[field] || '';

            const result = compileWorkflow(nodes, connections, configGetter);
            expect(result.success).toBe(true);
            expect(result.code).toContain('async function executeTool(args, state)');
            expect(result.code).toContain('https://example.com/api');
            expect(result.code).toContain('title>(.*?)<');
            expect(result.code).toContain('page_title');
            expect(result.code).toContain('return input.toUpperCase();');
            expect(result.code).toContain('return { success: true, finalData: currentData };');
        });
    });

    describe('saveWorkflowAsTool', () => {
        it('should show error if tool name is empty', () => {
            document.getElementById('workflow-name-input').value = '   ';
            saveWorkflowAsTool();
            expect(ui.showToast).toHaveBeenCalledWith('Please enter a tool name.', 'error');
        });

        it('should reject reserved system tool name', () => {
            document.getElementById('workflow-name-input').value = 'Calculator.js';
            saveWorkflowAsTool();
            expect(ui.showToast).toHaveBeenCalledWith(
                expect.stringContaining('is reserved for system tools'),
                'error'
            );
        });

        it('should show error if no aspect is active', () => {
            aspects.getCurrentAspect.mockReturnValue(null);
            document.getElementById('workflow-name-input').value = 'my_crawler';
            addWorkflowNode('start');

            saveWorkflowAsTool();

            expect(ui.showToast).toHaveBeenCalledWith('No active Aspect selected.', 'error');
        });

        it('should sanitize tool name and add tool to active aspect', () => {
            const mockAspect = { tools: [] };
            aspects.getCurrentAspect.mockReturnValue(mockAspect);
            document.getElementById('workflow-name-input').value = 'Scraper Tool';
            addWorkflowNode('start');

            saveWorkflowAsTool();

            expect(mockAspect.tools.length).toBe(1);
            expect(mockAspect.tools[0].name).toBe('Scraper_Tool.js');
            expect(mockAspect.tools[0].code).toContain('executeTool');
            expect(ui.markChangesUnsaved).toHaveBeenCalled();
            expect(ui.showToast).toHaveBeenCalledWith(expect.stringContaining('Saved "Scraper_Tool.js"'));
        });
    });

    describe('addWorkflowNode and uniqueness', () => {
        it('should assign unique IDs to each node even when called synchronously', () => {
            addWorkflowNode('fetch');
            addWorkflowNode('fetch');
            addWorkflowNode('fetch');

            const container = document.getElementById('workflow-nodes-container');
            const nodeElements = container.querySelectorAll('.workflow-node');
            expect(nodeElements.length).toBe(3);

            const ids = Array.from(nodeElements).map(el => el.id);
            const uniqueIds = new Set(ids);
            expect(uniqueIds.size).toBe(3);
        });

        it('should remove node and its connections via deleteWorkflowNode', () => {
            addWorkflowNode('start');
            addWorkflowNode('fetch');

            const container = document.getElementById('workflow-nodes-container');
            const nodes = container.querySelectorAll('.workflow-node');
            const fetchNodeId = nodes[1].id;

            expect(typeof window.deleteWorkflowNode).toBe('function');
            window.deleteWorkflowNode(fetchNodeId);

            const remaining = container.querySelectorAll('.workflow-node');
            expect(remaining.length).toBe(1);
            expect(remaining[0].id).not.toBe(fetchNodeId);
        });
    });
});
