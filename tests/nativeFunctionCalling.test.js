/**
 * Track 2: Native function calling — test suite
 *
 * Tests cover:
 *  1. buildToolSchema  — JSDoc-style, JSON block, and fallback schema extraction
 *  2. buildToolsParam  — filters to trusted tools only
 *  3. extractNativeToolCalls — non-streaming array and streaming Map inputs
 *  4. readSSEStream with onToolCall — accumulates tool_call deltas and fires callback
 *  5. streamChat — includes tools/tool_choice in the request body
 *  6. supportsNativeTools — provider capability detection
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from './mocks/server.js';

vi.mock('../src/js/modules/webllm.js', () => ({ streamWebLLMChat: vi.fn() }));

import { buildToolSchema, buildToolsParam } from '../src/js/modules/tools.js';
import { extractNativeToolCalls, readSSEStream, streamChat } from '../src/js/modules/llm.js';
import { supportsNativeTools } from '../src/js/modules/providers.js';
import { hashToolCode } from '../src/js/modules/aspects.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readerFrom(chunks) {
    let i = 0;
    const encoder = new TextEncoder();
    return {
        read: () => Promise.resolve(
            i < chunks.length
                ? { done: false, value: encoder.encode(chunks[i++]) }
                : { done: true }
        )
    };
}

const toolCallChunk = (index, name, args, finishReason = null) => {
    const delta = { tool_calls: [{ index, function: { name, arguments: args } }] };
    const choice = { delta, ...(finishReason ? { finish_reason: finishReason } : {}) };
    return `data: ${JSON.stringify({ choices: [choice] })}\n\n`;
};

const finishToolsChunk = () =>
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\n`;

function trustedTool(name, code, extra = {}) {
    return { name, code, state: {}, trustedHash: hashToolCode(code), ...extra };
}

// ---------------------------------------------------------------------------
// 1. buildToolSchema
// ---------------------------------------------------------------------------

describe('buildToolSchema', () => {
    it('produces a minimal schema when no annotation is present', () => {
        const tool = { name: 'MyTool.js', code: 'async function executeTool() {}', description: 'Does stuff' };
        const schema = buildToolSchema(tool);
        expect(schema.type).toBe('function');
        expect(schema.function.name).toBe('MyTool');
        expect(schema.function.description).toBe('Does stuff');
        expect(schema.function.parameters.type).toBe('object');
        expect(schema.function.parameters.additionalProperties).toBe(true);
    });

    it('strips .js from the function name', () => {
        const schema = buildToolSchema({ name: 'Calculator.js', code: '' });
        expect(schema.function.name).toBe('Calculator');
    });

    it('parses a JSDoc-style @tool-schema annotation', () => {
        const code = [
            '// @tool-schema',
            '// description: Fetches current weather',
            '// param city string The city name (required)',
            '// param units string celsius or fahrenheit (optional, default: celsius)',
            'async function executeTool(args) {}'
        ].join('\n');

        const schema = buildToolSchema({ name: 'Weather.js', code });
        expect(schema.function.description).toBe('Fetches current weather');
        expect(schema.function.parameters.properties.city).toMatchObject({ type: 'string' });
        expect(schema.function.parameters.properties.units).toMatchObject({ type: 'string' });
        // required only contains non-optional params
        expect(schema.function.parameters.required).toEqual(['city']);
        expect(schema.function.parameters.required).not.toContain('units');
    });

    it('parses a JSON block @schema annotation', () => {
        const code = [
            '/* @schema',
            '{"description":"Run calculation","parameters":{"type":"object","properties":{"expression":{"type":"string"}},"required":["expression"]}}',
            '*/',
            'async function executeTool(args) {}'
        ].join('\n');

        const schema = buildToolSchema({ name: 'Calculator.js', code });
        expect(schema.function.description).toBe('Run calculation');
        expect(schema.function.parameters.required).toEqual(['expression']);
        expect(schema.function.parameters.properties.expression).toMatchObject({ type: 'string' });
    });

    it('falls back gracefully when JSON block annotation is malformed', () => {
        const code = '/* @schema\n{ invalid json }\n*/\nasync function executeTool(args) {}';
        const schema = buildToolSchema({ name: 'Broken.js', code, description: 'fallback desc' });
        // Should fall through to fallback schema
        expect(schema.function.name).toBe('Broken');
        expect(schema.function.description).toBe('fallback desc');
        expect(schema.function.parameters.additionalProperties).toBe(true);
    });

    it('stops the JSDoc block at the first non-comment line', () => {
        const code = [
            '// @tool-schema',
            '// description: Short',
            '// param x number The x value (required)',
            '', // blank non-comment line ends block
            '// param y number NOT parsed',
            'async function executeTool(args) {}'
        ].join('\n');

        const schema = buildToolSchema({ name: 'Tool.js', code });
        expect(schema.function.parameters.properties).toHaveProperty('x');
        expect(schema.function.parameters.properties).not.toHaveProperty('y');
    });
});

// ---------------------------------------------------------------------------
// 2. buildToolsParam
// ---------------------------------------------------------------------------

describe('buildToolsParam', () => {
    it('returns an empty array for an aspect with no tools', () => {
        expect(buildToolsParam({ tools: [] })).toEqual([]);
        expect(buildToolsParam(null)).toEqual([]);
    });

    it('excludes untrusted tools', () => {
        const aspect = {
            tools: [
                { name: 'Trusted.js', code: 'async function executeTool(){}', trustedHash: hashToolCode('async function executeTool(){}') },
                { name: 'Untrusted.js', code: 'async function executeTool(){}', trustedHash: 'wrong-hash' }
            ]
        };
        const result = buildToolsParam(aspect);
        expect(result).toHaveLength(1);
        expect(result[0].function.name).toBe('Trusted');
    });

    it('includes all trusted tools', () => {
        const code = 'async function executeTool(){}';
        const aspect = {
            tools: [
                trustedTool('Alpha.js', code),
                trustedTool('Beta.js', code)
            ]
        };
        const result = buildToolsParam(aspect);
        expect(result).toHaveLength(2);
        expect(result.map(r => r.function.name)).toEqual(['Alpha', 'Beta']);
    });

    it('each entry has the required OpenAI schema shape', () => {
        const code = 'async function executeTool(){}';
        const [entry] = buildToolsParam({ tools: [trustedTool('Foo.js', code)] });
        expect(entry).toMatchObject({
            type: 'function',
            function: {
                name: 'Foo',
                parameters: { type: 'object' }
            }
        });
    });
});

// ---------------------------------------------------------------------------
// 3. extractNativeToolCalls
// ---------------------------------------------------------------------------

describe('extractNativeToolCalls', () => {
    it('returns empty array for null / undefined', () => {
        expect(extractNativeToolCalls(null)).toEqual([]);
        expect(extractNativeToolCalls(undefined)).toEqual([]);
    });

    it('extracts calls from a non-streaming tool_calls array', () => {
        const raw = [
            { id: 'call_1', function: { name: 'Weather', arguments: '{"city":"Tokyo"}' } },
            { id: 'call_2', function: { name: 'Calculator', arguments: '{"expression":"2+2"}' } }
        ];
        const calls = extractNativeToolCalls(raw);
        expect(calls).toHaveLength(2);
        expect(calls[0]).toEqual({ name: 'Weather', args: '{"city":"Tokyo"}' });
        expect(calls[1]).toEqual({ name: 'Calculator', args: '{"expression":"2+2"}' });
    });

    it('skips entries with no function name in the array form', () => {
        const raw = [{ id: 'x', function: { arguments: '{}' } }]; // no name
        expect(extractNativeToolCalls(raw)).toEqual([]);
    });

    it('extracts calls from a streaming Map', () => {
        const m = new Map([
            [0, { id: 'c1', name: 'WeatherTool', argsChunks: ['{"city":', '"Paris"}'] }],
            [1, { id: 'c2', name: 'Calculator', argsChunks: ['{"expr":"1+1"}'] }]
        ]);
        const calls = extractNativeToolCalls(m);
        expect(calls).toHaveLength(2);
        expect(calls[0]).toEqual({ name: 'WeatherTool', args: '{"city":"Paris"}' });
        expect(calls[1]).toEqual({ name: 'Calculator', args: '{"expr":"1+1"}' });
    });

    it('returns entries in index order from the Map', () => {
        // Insert out of order
        const m = new Map([
            [2, { id: '', name: 'C', argsChunks: [] }],
            [0, { id: '', name: 'A', argsChunks: [] }],
            [1, { id: '', name: 'B', argsChunks: [] }]
        ]);
        const calls = extractNativeToolCalls(m);
        expect(calls.map(c => c.name)).toEqual(['A', 'B', 'C']);
    });

    it('skips Map entries with no name', () => {
        const m = new Map([[0, { id: 'x', name: '', argsChunks: ['{}'] }]]);
        expect(extractNativeToolCalls(m)).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// 4. readSSEStream with onToolCall
// ---------------------------------------------------------------------------

describe('readSSEStream — native tool call path', () => {
    it('fires onToolCall when finish_reason is tool_calls', async () => {
        const chunks = [
            toolCallChunk(0, 'Weather', '{"city":'),
            toolCallChunk(0, '',       '"Tokyo"}'),
            finishToolsChunk()
        ];

        const receivedCalls = [];
        const text = await readSSEStream(
            readerFrom(chunks),
            () => {},
            (calls) => receivedCalls.push(...calls)
        );

        expect(text).toBe('');  // no content delta
        expect(receivedCalls).toHaveLength(1);
        expect(receivedCalls[0]).toMatchObject({ name: 'Weather', args: '{"city":"Tokyo"}' });
    });

    it('accumulates multiple tool calls from a streaming response', async () => {
        const chunks = [
            toolCallChunk(0, 'ToolA', '{"a":1}'),
            toolCallChunk(1, 'ToolB', '{"b":2}'),
            finishToolsChunk()
        ];

        const receivedCalls = [];
        await readSSEStream(
            readerFrom(chunks),
            () => {},
            (calls) => receivedCalls.push(...calls)
        );

        expect(receivedCalls).toHaveLength(2);
        expect(receivedCalls[0].name).toBe('ToolA');
        expect(receivedCalls[1].name).toBe('ToolB');
    });

    it('does not fire onToolCall for normal finish_reason: stop', async () => {
        const chunks = [
            `data: ${JSON.stringify({ choices: [{ delta: { content: 'hi' } }] })}\n\n`,
            `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`
        ];

        let toolCallFired = false;
        const text = await readSSEStream(
            readerFrom(chunks),
            () => {},
            () => { toolCallFired = true; }
        );

        expect(text).toBe('hi');
        expect(toolCallFired).toBe(false);
    });

    it('still yields normal content when there are no tool_calls', async () => {
        const chunks = [
            `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] })}\n\n`
        ];
        const text = await readSSEStream(readerFrom(chunks), null, null);
        expect(text).toBe('Hello');
    });
});

// ---------------------------------------------------------------------------
// 5. streamChat — includes tools in request body
// ---------------------------------------------------------------------------

describe('streamChat — tools in request body', () => {
    const delta = (text) =>
        `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

    beforeEach(() => server.resetHandlers());

    it('adds tools and tool_choice when params.tools is a non-empty array', async () => {
        let sentBody = null;
        server.use(http.post('http://localhost:11434/v1/chat/completions', async ({ request }) => {
            sentBody = await request.json();
            return new HttpResponse(delta('ok'), {
                headers: { 'Content-Type': 'text/event-stream' }
            });
        }));

        const toolDef = { type: 'function', function: { name: 'Foo', parameters: { type: 'object', properties: {} } } };
        await streamChat({
            target: { url: 'http://localhost:11434/v1', key: '', model: 'm' },
            messages: [{ role: 'user', content: 'hi' }],
            params: { tools: [toolDef] }
        });

        expect(sentBody.tools).toEqual([toolDef]);
        expect(sentBody.tool_choice).toBe('auto');
    });

    it('does NOT add tools or tool_choice when params.tools is empty', async () => {
        let sentBody = null;
        server.use(http.post('http://localhost:11434/v1/chat/completions', async ({ request }) => {
            sentBody = await request.json();
            return new HttpResponse(delta('ok'), {
                headers: { 'Content-Type': 'text/event-stream' }
            });
        }));

        await streamChat({
            target: { url: 'http://localhost:11434/v1', key: '', model: 'm' },
            messages: [],
            params: { tools: [] }
        });

        expect('tools' in sentBody).toBe(false);
        expect('tool_choice' in sentBody).toBe(false);
    });

    it('does NOT add tools when params.tools is absent', async () => {
        let sentBody = null;
        server.use(http.post('http://localhost:11434/v1/chat/completions', async ({ request }) => {
            sentBody = await request.json();
            return new HttpResponse(delta('ok'), {
                headers: { 'Content-Type': 'text/event-stream' }
            });
        }));

        await streamChat({
            target: { url: 'http://localhost:11434/v1', key: '', model: 'm' },
            messages: [],
            params: {}
        });

        expect('tools' in sentBody).toBe(false);
        expect('tool_choice' in sentBody).toBe(false);
    });

    it('routes onToolCall through to readSSEStream when the server sends tool_calls', async () => {
        const chunks = [
            toolCallChunk(0, 'MyTool', '{"x":1}'),
            finishToolsChunk()
        ].join('');

        server.use(http.post('http://localhost:11434/v1/chat/completions', () =>
            new HttpResponse(chunks, { headers: { 'Content-Type': 'text/event-stream' } })
        ));

        const toolCallFired = [];
        const toolDef = { type: 'function', function: { name: 'MyTool', parameters: { type: 'object', properties: {} } } };

        await streamChat({
            target: { url: 'http://localhost:11434/v1', key: '', model: 'm' },
            messages: [],
            params: { tools: [toolDef] },
            onToolCall: (calls) => toolCallFired.push(...calls)
        });

        expect(toolCallFired).toHaveLength(1);
        expect(toolCallFired[0]).toMatchObject({ name: 'MyTool', args: '{"x":1}' });
    });
});

// ---------------------------------------------------------------------------
// 6. supportsNativeTools
// ---------------------------------------------------------------------------

describe('supportsNativeTools', () => {
    it('returns true for known capable hosted providers', () => {
        expect(supportsNativeTools('https://api.openai.com/v1')).toBe(true);
        expect(supportsNativeTools('https://api.groq.com/openai/v1')).toBe(true);
        expect(supportsNativeTools('https://api.cerebras.ai/v1')).toBe(true);
        expect(supportsNativeTools('https://openrouter.ai/api/v1')).toBe(true);
        expect(supportsNativeTools('https://api.mistral.ai/v1')).toBe(true);
        expect(supportsNativeTools('https://api.deepseek.com/v1')).toBe(true);
        expect(supportsNativeTools('https://generativelanguage.googleapis.com/v1beta/openai')).toBe(true);
    });

    it('returns true for Ollama (port 11434) and LM Studio (port 1234)', () => {
        expect(supportsNativeTools('http://localhost:11434/v1')).toBe(true);
        expect(supportsNativeTools('http://127.0.0.1:11434/v1')).toBe(true);
        expect(supportsNativeTools('http://localhost:1234/v1')).toBe(true);
    });

    it('returns false for WebLLM', () => {
        expect(supportsNativeTools('webllm')).toBe(false);
    });

    it('returns false for null / empty', () => {
        expect(supportsNativeTools(null)).toBe(false);
        expect(supportsNativeTools('')).toBe(false);
        expect(supportsNativeTools(undefined)).toBe(false);
    });

    it('returns false for unknown / custom URLs (conservative default)', () => {
        expect(supportsNativeTools('https://my-custom-endpoint.example.com/v1')).toBe(false);
        expect(supportsNativeTools('http://localhost:5001/v1')).toBe(false); // KoboldCpp
        expect(supportsNativeTools('http://localhost:8000/v1')).toBe(false); // vLLM
        expect(supportsNativeTools('http://localhost:8080/v1')).toBe(false); // llama.cpp
    });

    it('returns false for providers similar to but not matching known ones', () => {
        // ensure we do not match on suffix/substring
        expect(supportsNativeTools('https://not-api.openai.com/v1')).toBe(false);
    });
});
