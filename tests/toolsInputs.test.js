import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TextEncoder } from 'util';
import * as tools from '../src/js/modules/tools.js';
import { state } from '../src/js/modules/state.js';
import * as aspectsModule from '../src/js/modules/aspects.js';
import * as uiModule from '../src/js/modules/ui.js';
import * as chatModule from '../src/js/modules/chat.js';
import * as dbModule from '../src/js/modules/db.js';

vi.mock('../src/js/modules/aspects.js', () => ({
    getCurrentAspect: vi.fn(),
}));

vi.mock('../src/js/modules/ui.js', () => ({
    markChangesUnsaved: vi.fn(),
    setChatLoadingState: vi.fn(),
    addSystemLog: vi.fn(),
    updateSystemLog: vi.fn(),
    renderConversationList: vi.fn(),
}));

vi.mock('../src/js/modules/chat.js', () => ({
    renderChatMessages: vi.fn(),
    createStreamingBubble: vi.fn().mockReturnValue({}),
    updateStreamingBubble: vi.fn(),
}));

vi.mock('../src/js/modules/db.js', () => ({
    getKnowledgeFilesText: vi.fn().mockResolvedValue('Extra file knowledge'),
    saveMemory: vi.fn(),
}));

// Worker mock that actually executes the tool code captured in the Blob source,
// so agentic-loop / loop-protection branches (which depend on real tool output) run.
const realWorker = () => {
    let capturedCode = null;
    const RealBlob = global.Blob;
    global.Blob = class { constructor(parts) { capturedCode = parts.join(''); } };
    global.URL.createObjectURL = vi.fn().mockReturnValue('u');
    global.URL.revokeObjectURL = vi.fn();

    global.Worker = class Worker {
        constructor() {
            const code = capturedCode;
            this._code = code;
        }
        postMessage(data) {
            const handlers = [];
            const self = {
                aspectMemory: undefined,
                onmessage: null,
                postMessage: (msg) => { if (this.onmessage) this.onmessage({ data: msg }); },
            };
            // Evaluate the worker source so it assigns self.onmessage, then invoke it.
            const fn = new Function('self', 'message', `${this._code}\n; if (typeof self.onmessage === 'function') self.onmessage({ data: message });`);
            fn(self, data);
        }
        terminate() {}
    };
    return () => { global.Blob = RealBlob; };
};

describe('buildApiMessages - inputs, variables and edge cases', () => {
    const aspectWith = (chatHistory) => ({
        id: 'a',
        instructions: 'inst',
        knowledge: 'kb',
        chatHistory,
    });

    it('always starts with the system prompt as the first message', () => {
        const aspect = aspectWith([]);
        const msgs = tools.buildApiMessages(aspect, 'SYS_PROMPT', null, 5);
        expect(msgs[0]).toEqual({ role: 'system', content: 'SYS_PROMPT' });
    });

    it('filters out non user/assistant roles (system, tool) from context', () => {
        const aspect = aspectWith([
            { role: 'system', content: 'ignored system' },
            { role: 'tool', content: 'ignored tool' },
            { role: 'user', content: 'keep me' },
            { role: 'assistant', content: 'keep me too' },
        ]);
        const msgs = tools.buildApiMessages(aspect, 'SYS', null, 10);
        const context = msgs.slice(1);
        expect(context).toEqual([
            { role: 'user', content: 'keep me' },
            { role: 'assistant', content: 'keep me too' },
        ]);
    });

    it('drops roles other than user/assistant (system, tool, unknown)', () => {
        const aspect = aspectWith([{ role: 'weird', content: 'x' }]);
        const msgs = tools.buildApiMessages(aspect, 'SYS', null, 10);
        // Only the system prompt remains; the unknown-role message is filtered out.
        expect(msgs).toHaveLength(1);
        expect(msgs[0].role).toBe('system');
    });

    it('respects maxContext by keeping only the last N messages', () => {
        const aspect = aspectWith([
            { role: 'user', content: '1' },
            { role: 'assistant', content: '2' },
            { role: 'user', content: '3' },
            { role: 'assistant', content: '4' },
        ]);
        const msgs = tools.buildApiMessages(aspect, 'SYS', null, 2);
        expect(msgs).toHaveLength(3);
        expect(msgs[1].content).toBe('3');
        expect(msgs[2].content).toBe('4');
    });

    it('treats maxContext of 0 as slice(-0) which keeps all messages (JS quirk)', () => {
        const aspect = aspectWith([{ role: 'user', content: '1' }]);
        const msgs = tools.buildApiMessages(aspect, 'SYS', null, 0);
        // slice(-0) === slice(0) returns the entire array, so the message is kept.
        expect(msgs).toHaveLength(2);
        expect(msgs[1]).toEqual({ role: 'user', content: '1' });
    });

    it('handles negative maxContext by slicing from the front (slice(-maxContext))', () => {
        const aspect = aspectWith([
            { role: 'user', content: '1' },
            { role: 'assistant', content: '2' },
            { role: 'user', content: '3' },
        ]);
        // slice(-(-2)) === slice(2) drops the first two messages, keeps the last
        const msgs = tools.buildApiMessages(aspect, 'SYS', null, -2);
        expect(msgs).toHaveLength(2);
        expect(msgs[1].content).toBe('3');
    });

    it('appends extraContext as a trailing system message when provided', () => {
        const aspect = aspectWith([]);
        const msgs = tools.buildApiMessages(aspect, 'SYS', 'TOOL_RESULTS', 5);
        expect(msgs).toHaveLength(2);
        expect(msgs[1].role).toBe('system');
        expect(msgs[1].content).toContain('TOOL_RESULTS');
        expect(msgs[1].content).toContain('[System Notification:');
    });

    it('appends extraContext only when it is a non-empty (truthy) string', () => {
        const aspect = aspectWith([]);
        // null and '' are falsy -> not appended
        expect(tools.buildApiMessages(aspect, 'SYS', null, 5)).toHaveLength(1);
        expect(tools.buildApiMessages(aspect, 'SYS', '', 5)).toHaveLength(1);
        // A whitespace-only string is still truthy -> it IS appended
        expect(tools.buildApiMessages(aspect, 'SYS', '   ', 5)).toHaveLength(2);
        expect(tools.buildApiMessages(aspect, 'SYS', '   ', 5)[1].content).toContain('[System Notification:');
    });

    it('preserves message ordering from history', () => {
        const aspect = aspectWith([
            { role: 'user', content: 'first' },
            { role: 'assistant', content: 'second' },
            { role: 'user', content: 'third' },
        ]);
        const msgs = tools.buildApiMessages(aspect, 'SYS', null, 10).map(m => m.content);
        expect(msgs).toEqual(['SYS', 'first', 'second', 'third']);
    });
});

describe('getApiEndpoint - input normalization edge cases', () => {
    it('trims surrounding whitespace', () => {
        expect(tools.getApiEndpoint('  https://api.com/v1  ')).toBe('https://api.com/v1/chat/completions');
    });

    it('collapses multiple trailing slashes', () => {
        expect(tools.getApiEndpoint('https://api.com/v1///')).toBe('https://api.com/v1/chat/completions');
    });

    it('honors the trailing-slash variant of the endpoint', () => {
        expect(tools.getApiEndpoint('https://api.com/v1/chat/completions/')).toBe('https://api.com/v1/chat/completions/');
    });

    it('does not double-append when already suffixed', () => {
        expect(tools.getApiEndpoint('https://api.com/v1/chat/completions')).toBe('https://api.com/v1/chat/completions');
    });

    it('produces a root-relative endpoint for empty input', () => {
        expect(tools.getApiEndpoint('')).toBe('/chat/completions');
    });

    it('handles localhost and custom ports', () => {
        expect(tools.getApiEndpoint('http://localhost:1234')).toBe('http://localhost:1234/chat/completions');
    });
});

describe('handleStreamResponse - SSE parsing edge cases', () => {
    const makeReader = (chunks) => {
        let i = 0;
        return {
            read() {
                if (i < chunks.length) {
                    return Promise.resolve({ done: false, value: new TextEncoder().encode(chunks[i++]) });
                }
                return Promise.resolve({ done: true });
            },
            releaseLock() {},
        };
    };

    it('accumulates multiple delta chunks', async () => {
        const reader = makeReader([
            'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
            'data: {"choices":[{"delta":{"content":"lo"}}]}\n',
            'data: [DONE]\n',
        ]);
        const msg = await tools.handleStreamResponse(reader, vi.fn(), vi.fn());
        expect(msg).toBe('Hello');
    });

    it('reassembles a JSON object split across chunk boundaries', async () => {
        const reader = makeReader([
            'data: {"choices":[{"delta":{"content":"He',
            'llo"}}]}\n',
        ]);
        const msg = await tools.handleStreamResponse(reader, vi.fn(), vi.fn());
        expect(msg).toBe('Hello');
    });

    it('flushes a final SSE line missing a trailing newline', async () => {
        const reader = makeReader([
            'data: {"choices":[{"delta":{"content":"Hel"}}]}\ndata: {"choices":[{"delta":{"content":"lo"}}]}',
        ]);
        const msg = await tools.handleStreamResponse(reader, vi.fn(), vi.fn());
        expect(msg).toBe('Hello');
    });

    it('ignores empty lines and non-data lines', async () => {
        const reader = makeReader([
            '\n',
            ': keep-alive\n',
            'data: {"choices":[{"delta":{"content":"X"}}]}\n',
        ]);
        const msg = await tools.handleStreamResponse(reader, vi.fn(), vi.fn());
        expect(msg).toBe('X');
    });

    it('ignores malformed partial JSON lines without throwing', async () => {
        const reader = makeReader([
            'data: {bad json\n',
            'data: {"choices":[{"delta":{"content":"OK"}}]}\n',
        ]);
        const msg = await tools.handleStreamResponse(reader, vi.fn(), vi.fn());
        expect(msg).toBe('OK');
    });

    it('skips delta chunks without content (e.g. role-only)', async () => {
        const reader = makeReader([
            'data: {"choices":[{"delta":{"role":"assistant"}}]}\n',
            'data: {"choices":[{"delta":{"content":"Y"}}]}\n',
        ]);
        const msg = await tools.handleStreamResponse(reader, vi.fn(), vi.fn());
        expect(msg).toBe('Y');
    });

    it('handles an empty stream', async () => {
        const reader = makeReader([]);
        const msg = await tools.handleStreamResponse(reader, vi.fn(), vi.fn());
        expect(msg).toBe('');
    });
});

describe('executeJavaScriptTool - argument and input edge cases', () => {
    const baseAspect = (toolsList) => ({
        id: 'current',
        chatHistory: [],
        tools: toolsList,
    });

    beforeEach(() => {
        state.currentAspectId = 'current';
    });

    it('returns a not-found error when the tool does not exist', async () => {
        aspectsModule.getCurrentAspect.mockReturnValue(baseAspect([]));
        const res = await tools.executeJavaScriptTool('ghost', '{}');
        expect(JSON.parse(res).error).toContain('not found');
    });

    it('parses valid JSON args', async () => {
        const aspect = baseAspect([
            { name: 'echo', code: 'async function executeTool(args, state) { return args; }' },
        ]);
        aspectsModule.getCurrentAspect.mockReturnValue(aspect);
        let capturedArgs;
        global.Worker = class Worker {
            constructor() {}
            postMessage(data) { capturedArgs = data.args; this.onmessage({ data: { success: true, result: capturedArgs, state: {} } }); }
            terminate() {}
        };
        global.URL.createObjectURL = vi.fn().mockReturnValue('u');
        global.URL.revokeObjectURL = vi.fn();
        const res = await tools.executeJavaScriptTool('echo', '{"x":1,"y":[2,3]}');
        expect(capturedArgs).toEqual({ x: 1, y: [2, 3] });
        expect(res).toContain('"x": 1');
        delete global.Worker; delete global.URL.createObjectURL; delete global.URL.revokeObjectURL;
    });

    it('falls back to raw string when args are not valid JSON', async () => {
        const aspect = baseAspect([
            { name: 'raw', code: 'async function executeTool(args, state) { return args; }' },
        ]);
        aspectsModule.getCurrentAspect.mockReturnValue(aspect);
        let capturedArgs;
        global.Worker = class Worker {
            constructor() {}
            postMessage(data) { capturedArgs = data.args; this.onmessage({ data: { success: true, result: capturedArgs, state: {} } }); }
            terminate() {}
        };
        global.URL.createObjectURL = vi.fn().mockReturnValue('u');
        global.URL.revokeObjectURL = vi.fn();
        await tools.executeJavaScriptTool('raw', 'just a plain string with no json');
        expect(capturedArgs).toBe('just a plain string with no json');
        delete global.Worker; delete global.URL.createObjectURL; delete global.URL.revokeObjectURL;
    });

    it('treats empty / whitespace args as empty object', async () => {
        const aspect = baseAspect([
            { name: 'empty', code: 'async function executeTool(args, state) { return args; }' },
        ]);
        aspectsModule.getCurrentAspect.mockReturnValue(aspect);
        let capturedArgs;
        global.Worker = class Worker {
            constructor() {}
            postMessage(data) { capturedArgs = data.args; this.onmessage({ data: { success: true, result: capturedArgs, state: {} } }); }
            terminate() {}
        };
        global.URL.createObjectURL = vi.fn().mockReturnValue('u');
        global.URL.revokeObjectURL = vi.fn();
        await tools.executeJavaScriptTool('empty', '');
        expect(capturedArgs).toEqual({});
        await tools.executeJavaScriptTool('empty', '   ');
        expect(capturedArgs).toEqual({});
        delete global.Worker; delete global.URL.createObjectURL; delete global.URL.revokeObjectURL;
    });

    it('trims surrounding whitespace from JSON args', async () => {
        const aspect = baseAspect([
            { name: 'trim', code: 'async function executeTool(args, state) { return args; }' },
        ]);
        aspectsModule.getCurrentAspect.mockReturnValue(aspect);
        let capturedArgs;
        global.Worker = class Worker {
            constructor() {}
            postMessage(data) { capturedArgs = data.args; this.onmessage({ data: { success: true, result: capturedArgs, state: {} } }); }
            terminate() {}
        };
        global.URL.createObjectURL = vi.fn().mockReturnValue('u');
        global.URL.revokeObjectURL = vi.fn();
        await tools.executeJavaScriptTool('trim', '   {"a":1}   ');
        expect(capturedArgs).toEqual({ a: 1 });
        delete global.Worker; delete global.URL.createObjectURL; delete global.URL.revokeObjectURL;
    });

    it('returns a runtime error when the worker reports failure', async () => {
        const aspect = baseAspect([
            { name: 'boom', code: 'async function executeTool(args, state) { throw new Error("kaboom"); }' },
        ]);
        aspectsModule.getCurrentAspect.mockReturnValue(aspect);
        global.Worker = class Worker {
            constructor() {}
            postMessage() { this.onmessage({ data: { success: false, error: 'kaboom' } }); }
            terminate() {}
        };
        global.URL.createObjectURL = vi.fn().mockReturnValue('u');
        global.URL.revokeObjectURL = vi.fn();
        const res = await tools.executeJavaScriptTool('boom', '{}');
        expect(JSON.parse(res).error).toContain('kaboom');
        delete global.Worker; delete global.URL.createObjectURL; delete global.URL.revokeObjectURL;
    });
});

describe('processAIResponseAndTools - multi-input and edge cases', () => {
    const aspectWithHistory = (tools = []) => ({ id: 'current', name: 'A', chatHistory: [], tools });

    let restoreBlob;
    beforeEach(() => {
        state.currentAspectId = 'current';
        state.consecutiveToolRuns = 0;
        vi.clearAllMocks();
        restoreBlob = realWorker();
        // Stop the real network call at the end of the tool pipeline.
        vi.spyOn(tools, 'sendAIRequest').mockResolvedValue(undefined);
    });

    afterEach(() => {
        restoreBlob();
        delete global.Worker; delete global.URL.createObjectURL; delete global.URL.revokeObjectURL;
    });

    it('coerces null/undefined message to empty string and stores assistant message', async () => {
        const aspect = aspectWithHistory();
        aspectsModule.getCurrentAspect.mockReturnValue(aspect);
        await tools.processAIResponseAndTools(null, aspect);
        expect(aspect.chatHistory.some(m => m.role === 'assistant' && m.content === '')).toBe(true);
    });

    it('pushes assistant message when there are no tool calls', async () => {
        const aspect = aspectWithHistory();
        aspectsModule.getCurrentAspect.mockReturnValue(aspect);
        await tools.processAIResponseAndTools('Just chatting', aspect);
        expect(aspect.chatHistory.at(-1)).toEqual({ role: 'assistant', content: 'Just chatting' });
    });

    it('extracts a single tool call without args', async () => {
        const aspect = aspectWithHistory([{ name: 't', code: 'async function executeTool(a,s){return "ok";}' }]);
        aspectsModule.getCurrentAspect.mockReturnValue(aspect);
        await tools.processAIResponseAndTools('Do [Run Tool: t] now', aspect);
        const logText = aspect.chatHistory.map(m => m.content).join('\n');
        expect(logText).toContain('Tool Executed:** `t`');
    });

    it('extracts multiple tool calls from a single message', async () => {
        const aspect = aspectWithHistory([
            { name: 'a', code: 'async function executeTool(a,s){return "a";}' },
            { name: 'b', code: 'async function executeTool(a,s){return "b";}' },
        ]);
        aspectsModule.getCurrentAspect.mockReturnValue(aspect);
        await tools.processAIResponseAndTools('Run [Run Tool: a] and [Run Tool: b(x)]', aspect);
        const logText = aspect.chatHistory.map(m => m.content).join('\n');
        expect(logText).toContain('Tool Executed:** `a`');
        expect(logText).toContain('Tool Executed:** `b`');
    });

    it('passes through parsed argument strings to the tool', async () => {
        const aspect = aspectWithHistory([{ name: 'calc', code: 'async function executeTool(a,s){return a;}' }]);
        aspectsModule.getCurrentAspect.mockReturnValue(aspect);
        await tools.processAIResponseAndTools('[Run Tool: calc({"n":42})]', aspect);
        const logText = aspect.chatHistory.map(m => m.content).join('\n');
        expect(logText).toContain('{"n":42}');
    });

    it('triggers the agentic loop when a tool result requests another tool', async () => {
        const aspect = aspectWithHistory([
            { name: 'outer', code: 'async function executeTool(a,s){return "[Run Tool: inner]";}' },
            { name: 'inner', code: 'async function executeTool(a,s){return "done";}' },
        ]);
        aspectsModule.getCurrentAspect.mockReturnValue(aspect);
        await tools.processAIResponseAndTools('[Run Tool: outer]', aspect);
        const logText = aspect.chatHistory.map(m => m.content).join('\n');
        expect(logText).toContain('Agentic Loop triggered');
        expect(logText).toContain('Tool Executed:** `inner`');
    });

    it('enforces the 15-consecutive-tool-run loop protection', async () => {
        const aspect = aspectWithHistory([
            { name: 'again', code: 'async function executeTool(a,s){return "[Run Tool: again]";}' },
        ]);
        aspectsModule.getCurrentAspect.mockReturnValue(aspect);
        // Start at 15 so the very next run exceeds the cap (no deep recursion).
        state.consecutiveToolRuns = 15;
        await tools.processAIResponseAndTools('[Run Tool: again]', aspect);
        const logText = aspect.chatHistory.map(m => m.content).join('\n');
        expect(logText).toContain('Loop protection triggered');
        expect(state.consecutiveToolRuns).toBe(0);
    });
});
