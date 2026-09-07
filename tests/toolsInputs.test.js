import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TextEncoder } from 'util';
import * as tools from '../src/js/modules/tools.js';
import { state } from '../src/js/modules/state.js';
import * as aspectsModule from '../src/js/modules/aspects.js';
import * as uiModule from '../src/js/modules/ui.js';
import * as chatModule from '../src/js/modules/chat.js';
import * as dbModule from '../src/js/modules/db.js';
import { hashToolCode } from '../src/js/modules/aspects.js';

/** Tool fixture with a matching trustedHash so the per-tool gate lets it run. */
const withTrust = (t) => ({ state: {}, ...t, trustedHash: t.trustedHash ?? hashToolCode(t.code) });

vi.mock('../src/js/modules/aspects.js', async (orig) => ({
    ...(await orig()),
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

// Tool execution is sandboxed in toolSandbox.js; this double runs the tool code
// directly (jsdom won't execute a sandboxed iframe) while keeping the same
// message contract, so agentic-loop / loop-protection branches still exercise
// real tool output. See tests/helpers/fakeToolSandbox.js.
vi.mock('../src/js/modules/toolSandbox.js', async () => ({
    runSandboxedTool: (await import('./helpers/fakeToolSandbox.js')).fakeRunSandboxedTool,
}));

describe('buildSystemPrompt - knowledge cap', () => {
    it('passes knowledge through untouched when under the cap', () => {
        const out = tools.buildSystemPrompt({ instructions: 'I', knowledge: 'small' }, ' + file text', 1000);
        expect(out).toContain('small + file text');
        expect(out).not.toContain('Knowledge truncated');
    });

    it('truncates and annotates knowledge that exceeds the cap', () => {
        const big = 'x'.repeat(5000);
        const out = tools.buildSystemPrompt({ instructions: 'I', knowledge: big }, '', 1000);
        expect(out).toContain('Knowledge truncated');
        // Body is clipped to the cap; the notice is appended after it.
        expect(out.indexOf('xxxx')).toBeGreaterThan(-1);
        expect(out.length).toBeLessThan(big.length);
    });

    it('applies no cap when the limit is missing or invalid', () => {
        const big = 'y'.repeat(3000);
        const out = tools.buildSystemPrompt({ instructions: 'I', knowledge: big }, '', undefined);
        expect(out).toContain(big);
        expect(out).not.toContain('Knowledge truncated');
    });
});

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
        tools: (toolsList || []).map(withTrust),
    });

    beforeEach(() => {
        state.currentAspectId = 'current';
    });

    it('returns a not-found error when the tool does not exist', async () => {
        aspectsModule.getCurrentAspect.mockReturnValue(baseAspect([]));
        const res = await tools.executeJavaScriptTool('ghost', '{}');
        expect(JSON.parse(res).error).toContain('not found');
    });

    it('refuses to run tools on an imported Aspect until they are reviewed', async () => {
        const { runSandboxedTool } = await import('../src/js/modules/toolSandbox.js');
        runSandboxedTool.mockClear();

        const aspect = baseAspect([
            { name: 'imported', code: 'async function executeTool(){ return "ran"; }' },
        ]);
        aspect.name = 'Shared Aspect';
        aspect.toolsReviewed = false;
        // Imported tools carry no matching trustedHash.
        delete aspect.tools[0].trustedHash;
        aspectsModule.getCurrentAspect.mockReturnValue(aspect);

        const res = await tools.executeJavaScriptTool('imported', '{}');
        expect(JSON.parse(res).error).toMatch(/not been reviewed/i);
        // The sandbox must never be entered for an unreviewed tool.
        expect(runSandboxedTool).not.toHaveBeenCalled();
    });

    it('parses valid JSON args and hands them to the tool', async () => {
        const aspect = baseAspect([
            { name: 'echo', code: 'async function executeTool(args, state) { return args; }' },
        ]);
        aspectsModule.getCurrentAspect.mockReturnValue(aspect);
        const res = await tools.executeJavaScriptTool('echo', '{"x":1,"y":[2,3]}');
        expect(JSON.parse(res)).toEqual({ x: 1, y: [2, 3] });
    });

    it('falls back to raw string when args are not valid JSON', async () => {
        const aspect = baseAspect([
            { name: 'raw', code: 'async function executeTool(args, state) { return args; }' },
        ]);
        aspectsModule.getCurrentAspect.mockReturnValue(aspect);
        const res = await tools.executeJavaScriptTool('raw', 'just a plain string with no json');
        expect(res).toBe('just a plain string with no json');
    });

    it('treats empty / whitespace args as empty object', async () => {
        const aspect = baseAspect([
            { name: 'empty', code: 'async function executeTool(args, state) { return args; }' },
        ]);
        aspectsModule.getCurrentAspect.mockReturnValue(aspect);
        expect(JSON.parse(await tools.executeJavaScriptTool('empty', ''))).toEqual({});
        expect(JSON.parse(await tools.executeJavaScriptTool('empty', '   '))).toEqual({});
    });

    it('trims surrounding whitespace from JSON args', async () => {
        const aspect = baseAspect([
            { name: 'trim', code: 'async function executeTool(args, state) { return args; }' },
        ]);
        aspectsModule.getCurrentAspect.mockReturnValue(aspect);
        const res = await tools.executeJavaScriptTool('trim', '   {"a":1}   ');
        expect(JSON.parse(res)).toEqual({ a: 1 });
    });

    it('returns a runtime error when the tool throws', async () => {
        const aspect = baseAspect([
            { name: 'boom', code: 'async function executeTool(args, state) { throw new Error("kaboom"); }' },
        ]);
        aspectsModule.getCurrentAspect.mockReturnValue(aspect);
        const res = await tools.executeJavaScriptTool('boom', '{}');
        expect(JSON.parse(res).error).toContain('kaboom');
    });

    it('reports malformed JSON args instead of passing them through half-parsed', async () => {
        const aspect = baseAspect([
            { name: 'echo', code: 'async function executeTool(args) { return args; }' },
        ]);
        aspectsModule.getCurrentAspect.mockReturnValue(aspect);
        const res = await tools.executeJavaScriptTool('echo', '{"x": 1,');   // starts like JSON, invalid
        expect(JSON.parse(res).error).toMatch(/could not parse the arguments/i);
    });

    it('refuses to persist a runaway state blob', async () => {
        const aspect = baseAspect([
            { name: 'hog', code: 'async function executeTool(args, state) { state.big = "z".repeat(300000); return "ok"; }' },
        ]);
        aspectsModule.getCurrentAspect.mockReturnValue(aspect);
        const res = await tools.executeJavaScriptTool('hog', '{}');
        expect(JSON.parse(res).error).toMatch(/state was not saved/i);
        expect(aspect.tools[0].state.big).toBeUndefined();
    });
});

describe('processAIResponseAndTools - multi-input and edge cases', () => {
    const aspectWithHistory = (tools = []) => ({ id: 'current', name: 'A', chatHistory: [], tools: tools.map(withTrust) });

    beforeEach(() => {
        state.currentAspectId = 'current';
        state.consecutiveToolRuns = 0;
        vi.clearAllMocks();
        // Tool code runs through the mocked toolSandbox (see top of file).
        // Stop the real network call at the end of the tool pipeline.
        vi.spyOn(tools, 'sendAIRequest').mockResolvedValue(undefined);
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

    it('runs at most 8 tool calls from one model message', async () => {
        const aspect = aspectWithHistory([{ name: 't', code: 'async function executeTool(a,s){return "ok";}' }]);
        aspectsModule.getCurrentAspect.mockReturnValue(aspect);
        const msg = Array.from({ length: 20 }, () => '[Run Tool: t]').join(' ');
        await tools.processAIResponseAndTools(msg, aspect);
        const runs = aspect.chatHistory.filter(m => /Tool Executed:\*\* `t`/.test(m.content || '')).length;
        expect(runs).toBe(8);
        expect(aspect.chatHistory.map(m => m.content).join('\n')).toMatch(/first 8 of 20 tool calls/);
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

    it('chains to another tool only when a tool explicitly opts in via __aspectToolCalls', async () => {
        const aspect = aspectWithHistory([
            { name: 'outer', code: 'async function executeTool(a,s){return { __aspectToolCalls: [{ name: "inner" }] };}' },
            { name: 'inner', code: 'async function executeTool(a,s){return "done";}' },
        ]);
        aspectsModule.getCurrentAspect.mockReturnValue(aspect);
        await tools.processAIResponseAndTools('[Run Tool: outer]', aspect);
        const logText = aspect.chatHistory.map(m => m.content).join('\n');
        expect(logText).toContain('Agentic Loop triggered');
        expect(logText).toContain('Tool Executed:** `inner`');
    });

    it('does NOT chain when a tool merely returns [Run Tool: ...] as free text', async () => {
        const aspect = aspectWithHistory([
            { name: 'outer', code: 'async function executeTool(a,s){return "[Run Tool: inner]";}' },
            { name: 'inner', code: 'async function executeTool(a,s){return "done";}' },
        ]);
        aspectsModule.getCurrentAspect.mockReturnValue(aspect);
        await tools.processAIResponseAndTools('[Run Tool: outer]', aspect);
        const logText = aspect.chatHistory.map(m => m.content).join('\n');
        expect(logText).not.toContain('Agentic Loop triggered');
        expect(logText).not.toContain('Tool Executed:** `inner`');
    });

    it('enforces the 15-consecutive-tool-run loop protection', async () => {
        const aspect = aspectWithHistory([
            { name: 'again', code: 'async function executeTool(a,s){return { __aspectToolCalls: [{ name: "again" }] };}' },
        ]);
        aspectsModule.getCurrentAspect.mockReturnValue(aspect);
        // Start at 15 so the very next run exceeds the cap (no deep recursion).
        state.consecutiveToolRuns = 15;
        await tools.processAIResponseAndTools('[Run Tool: again]', aspect);
        const logText = aspect.chatHistory.map(m => m.content).join('\n');
        expect(logText).toMatch(/Loop protection/);
        expect(state.consecutiveToolRuns).toBe(0);
    });
});
