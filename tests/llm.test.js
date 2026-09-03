import { describe, it, expect, beforeEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from './mocks/server.js';

vi.mock('../src/js/modules/webllm.js', () => ({
    streamWebLLMChat: vi.fn()
}));

import { streamWebLLMChat } from '../src/js/modules/webllm.js';
import {
    readSSEStream,
    primaryTarget,
    fallbackTarget,
    validateTarget,
    streamChat,
    completeChat,
    streamChatWithFallback
} from '../src/js/modules/llm.js';

/** Build a reader that yields the given strings as UTF-8 chunks. */
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

function sseResponse(chunks) {
    return new HttpResponse(chunks.join(''), {
        headers: { 'Content-Type': 'text/event-stream' }
    });
}

const delta = (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

describe('readSSEStream', () => {
    it('assembles content deltas in order', async () => {
        const seen = [];
        const full = await readSSEStream(readerFrom([delta('Hel'), delta('lo')]), d => seen.push(d));

        expect(full).toBe('Hello');
        expect(seen).toEqual(['Hel', 'lo']);
    });

    it('carries a JSON object split across two chunks', async () => {
        // Network chunk boundaries do not respect line boundaries.
        const full = await readSSEStream(readerFrom([
            'data: {"choices": [{"delta": {"content": "He"}}]}\ndata: {"choi',
            'ces": [{"delta": {"content": "llo"}}]}\n'
        ]));
        expect(full).toBe('Hello');
    });

    it('reads a final line with no trailing newline', async () => {
        const full = await readSSEStream(readerFrom([
            'data: {"choices":[{"delta":{"content":"Hel"}}]}\ndata: {"choices":[{"delta":{"content":"lo"}}]}'
        ]));
        expect(full).toBe('Hello');
    });

    it('ignores [DONE], blank lines, comments and malformed JSON', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const full = await readSSEStream(readerFrom([
            '\n: keep-alive comment\n',
            delta('ok'),
            'data: {not json}\n',
            'data: [DONE]\n'
        ]));
        expect(full).toBe('ok');
        warn.mockRestore();
    });

    it('surfaces an error object streamed after a 200 OK', async () => {
        await expect(readSSEStream(readerFrom([
            'data: {"error":{"message":"model not loaded"}}\n'
        ]))).rejects.toThrow('model not loaded');
    });

    it('tolerates CRLF line endings', async () => {
        const full = await readSSEStream(readerFrom([
            'data: {"choices":[{"delta":{"content":"win"}}]}\r\n'
        ]));
        expect(full).toBe('win');
    });
});

describe('target resolution', () => {
    it('builds a WebLLM target when the provider is webllm', () => {
        const target = primaryTarget({ provider: 'webllm', model: 'Llama-3-8B' });
        expect(target.isWebLLM).toBe(true);
        expect(target.model).toBe('Llama-3-8B');
    });

    it('trims whitespace out of the HTTP target', () => {
        const target = primaryTarget({ provider: 'custom', apiUrl: '  http://localhost:11434/v1 ', apiKey: ' k ', model: ' m ' });
        expect(target).toMatchObject({ url: 'http://localhost:11434/v1', key: 'k', model: 'm', isWebLLM: false });
    });

    it('returns no fallback target when none is configured', () => {
        expect(fallbackTarget({})).toBeNull();
        expect(fallbackTarget({ fallbackProvider: '' })).toBeNull();
        // Configured but incomplete is also unusable.
        expect(fallbackTarget({ fallbackProvider: 'webllm', fallbackModel: '' })).toBeNull();
        expect(fallbackTarget({ fallbackProvider: 'custom', fallbackUrl: '' })).toBeNull();
    });

    it('builds a usable fallback target', () => {
        expect(fallbackTarget({ fallbackProvider: 'webllm', fallbackModel: 'Phi-3' }))
            .toMatchObject({ isWebLLM: true, model: 'Phi-3' });

        expect(fallbackTarget({ fallbackProvider: 'custom', fallbackUrl: 'http://localhost:1234/v1', fallbackModel: 'm' }))
            .toMatchObject({ isWebLLM: false, url: 'http://localhost:1234/v1', model: 'm' });
    });
});

describe('validateTarget', () => {
    it('accepts a keyless local server', () => {
        expect(validateTarget({ url: 'http://localhost:11434/v1', key: '', model: 'llama3.1:8b' })).toBeNull();
    });

    it('accepts a local server with no model, which llama.cpp allows', () => {
        expect(validateTarget({ url: 'http://localhost:8080/v1', key: '', model: '' })).toBeNull();
    });

    it('demands a key for a hosted provider', () => {
        const error = validateTarget({ url: 'https://api.openai.com/v1', key: '', model: 'gpt-4o' });
        expect(error).toContain('requires an API key');
        // And it points at the alternative.
        expect(error).toContain('local server');
    });

    it('demands a model for a hosted provider', () => {
        expect(validateTarget({ url: 'https://api.openai.com/v1', key: 'sk-x', model: '' }))
            .toContain('No model selected');
    });

    it('demands a model for WebLLM', () => {
        expect(validateTarget({ isWebLLM: true, model: '' })).toContain('No WebLLM model selected');
        expect(validateTarget({ isWebLLM: true, model: 'Phi-3' })).toBeNull();
    });

    it('rejects a missing endpoint', () => {
        expect(validateTarget({ url: '', key: '', model: 'm' })).toContain('not configured');
        expect(validateTarget(null)).toContain('No provider configured');
    });
});

describe('streamChat', () => {
    beforeEach(() => {
        server.resetHandlers();
        vi.clearAllMocks();
    });

    it('streams from a keyless local endpoint and sends no Authorization header', async () => {
        let sawAuth = 'unset';
        let sentBody = null;
        server.use(http.post('http://localhost:11434/v1/chat/completions', async ({ request }) => {
            sawAuth = request.headers.get('authorization');
            sentBody = await request.json();
            return sseResponse([delta('local '), delta('reply')]);
        }));

        const result = await streamChat({
            target: { url: 'http://localhost:11434/v1', key: '', model: 'llama3.1:8b' },
            messages: [{ role: 'user', content: 'hi' }],
            params: { temperature: 0.3 }
        });

        expect(result).toBe('local reply');
        expect(sawAuth).toBeNull();
        expect(sentBody).toMatchObject({ model: 'llama3.1:8b', stream: true, temperature: 0.3 });
    });

    it('omits the model field entirely when a local server has none set', async () => {
        let sentBody = null;
        server.use(http.post('http://localhost:8080/v1/chat/completions', async ({ request }) => {
            sentBody = await request.json();
            return sseResponse([delta('ok')]);
        }));

        await streamChat({
            target: { url: 'http://localhost:8080/v1', key: '', model: '' },
            messages: [{ role: 'user', content: 'hi' }]
        });

        expect('model' in sentBody).toBe(false);
    });

    it('omits max_tokens and top_p unless set', async () => {
        let sentBody = null;
        server.use(http.post('http://localhost:11434/v1/chat/completions', async ({ request }) => {
            sentBody = await request.json();
            return sseResponse([delta('ok')]);
        }));

        await streamChat({
            target: { url: 'http://localhost:11434/v1', key: '', model: 'm' },
            messages: [],
            params: { temperature: 0.7, maxTokens: 0 }
        });

        expect('max_tokens' in sentBody).toBe(false);
        expect('top_p' in sentBody).toBe(false);
    });

    it('routes a WebLLM target to the in-browser engine', async () => {
        streamWebLLMChat.mockResolvedValue('from webllm');

        const result = await streamChat({
            target: { isWebLLM: true, model: 'Phi-3', url: 'webllm' },
            messages: [{ role: 'user', content: 'hi' }],
            params: { temperature: 0.5 }
        });

        expect(result).toBe('from webllm');
        expect(streamWebLLMChat).toHaveBeenCalledWith(expect.objectContaining({ model: 'Phi-3', temperature: 0.5 }));
    });

    it('explains a failed local connection in terms the user can act on', async () => {
        server.use(http.post('http://localhost:11434/v1/chat/completions', () => HttpResponse.error()));

        await expect(streamChat({
            target: { url: 'http://localhost:11434/v1', key: '', model: 'm' },
            messages: []
        })).rejects.toThrow('OLLAMA_ORIGINS');
    });

    it('reports an HTTP error status', async () => {
        server.use(http.post('http://localhost:11434/v1/chat/completions', () =>
            HttpResponse.json({ error: { message: 'model missing' } }, { status: 404 })));

        await expect(streamChat({
            target: { url: 'http://localhost:11434/v1', key: '', model: 'm' },
            messages: []
        })).rejects.toThrow('model missing');
    });
});

describe('completeChat', () => {
    beforeEach(() => server.resetHandlers());

    it('returns a non-streamed message', async () => {
        server.use(http.post('http://localhost:11434/v1/chat/completions', () =>
            HttpResponse.json({ choices: [{ message: { content: 'one shot' } }] })));

        await expect(completeChat({
            target: { url: 'http://localhost:11434/v1', key: '', model: 'm' },
            messages: []
        })).resolves.toBe('one shot');
    });

    it('rejects an empty completion', async () => {
        server.use(http.post('http://localhost:11434/v1/chat/completions', () =>
            HttpResponse.json({ choices: [] })));

        await expect(completeChat({
            target: { url: 'http://localhost:11434/v1', key: '', model: 'm' },
            messages: []
        })).rejects.toThrow('Empty response from model');
    });
});

describe('streamChatWithFallback', () => {
    beforeEach(() => {
        server.resetHandlers();
        vi.clearAllMocks();
    });

    const settings = {
        provider: 'custom',
        apiUrl: 'https://api.test.com/v1',
        apiKey: 'sk-x',
        model: 'gpt-x',
        fallbackProvider: 'webllm',
        fallbackModel: 'Phi-3'
    };

    it('uses the primary provider when it works', async () => {
        server.use(http.post('https://api.test.com/v1/chat/completions', () => sseResponse([delta('primary')])));

        await expect(streamChatWithFallback({ settings, messages: [] })).resolves.toBe('primary');
        expect(streamWebLLMChat).not.toHaveBeenCalled();
    });

    it('falls back when the primary provider is unreachable', async () => {
        server.use(http.post('https://api.test.com/v1/chat/completions', () => HttpResponse.error()));
        streamWebLLMChat.mockResolvedValue('offline answer');

        const onFallback = vi.fn();
        const result = await streamChatWithFallback({ settings, messages: [], onFallback });

        expect(result).toBe('offline answer');
        expect(onFallback).toHaveBeenCalledTimes(1);
        expect(onFallback.mock.calls[0][1].label).toContain('WebLLM');
    });

    it('never retries a user abort on the fallback', async () => {
        // Stopping generation means stop, not "try the other provider".
        server.use(http.post('https://api.test.com/v1/chat/completions', () => {
            throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
        }));

        const controller = new AbortController();
        controller.abort();

        await expect(streamChatWithFallback({
            settings, messages: [], signal: controller.signal
        })).rejects.toThrow();
        expect(streamWebLLMChat).not.toHaveBeenCalled();
    });

    it('propagates the primary error when no fallback is configured', async () => {
        server.use(http.post('https://api.test.com/v1/chat/completions', () =>
            HttpResponse.json({ error: { message: 'boom' } }, { status: 500 })));

        await expect(streamChatWithFallback({
            settings: { ...settings, fallbackProvider: '' },
            messages: []
        })).rejects.toThrow('boom');
    });

    it('reports both failures when the fallback also fails', async () => {
        server.use(http.post('https://api.test.com/v1/chat/completions', () =>
            HttpResponse.json({ error: { message: 'primary down' } }, { status: 503 })));
        streamWebLLMChat.mockRejectedValue(new Error('no WebGPU'));

        await expect(streamChatWithFallback({ settings, messages: [] }))
            .rejects.toThrow(/primary down[\s\S]*no WebGPU/);
    });
});
