import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from './mocks/server.js';
import {
    PROVIDERS,
    WEBLLM_PROVIDER,
    getProvider,
    isLocalEndpoint,
    requiresApiKey,
    getApiEndpoint,
    getModelsEndpoint,
    buildHeaders,
    describeConnectionError,
    describeHttpError,
    fetchProviderModels,
    testConnection,
    mixedContentWarning
} from '../src/js/modules/providers.js';

describe('isLocalEndpoint', () => {
    it('recognises loopback hosts', () => {
        expect(isLocalEndpoint('http://localhost:11434/v1')).toBe(true);
        expect(isLocalEndpoint('http://127.0.0.1:1234/v1')).toBe(true);
        expect(isLocalEndpoint('http://[::1]:8080/v1')).toBe(true);
        expect(isLocalEndpoint('http://0.0.0.0:8080/v1')).toBe(true);
    });

    it('recognises private LAN ranges', () => {
        expect(isLocalEndpoint('http://192.168.1.50:1234/v1')).toBe(true);
        expect(isLocalEndpoint('http://10.0.0.7:8080/v1')).toBe(true);
        expect(isLocalEndpoint('http://172.16.4.2:8080/v1')).toBe(true);
        expect(isLocalEndpoint('http://172.31.255.254:8080/v1')).toBe(true);
        // Tailscale's CGNAT range — a very common way to reach a home GPU box.
        expect(isLocalEndpoint('http://100.101.102.103:11434/v1')).toBe(true);
    });

    it('recognises mDNS and internal suffixes', () => {
        expect(isLocalEndpoint('http://gpu-box.local:11434/v1')).toBe(true);
        expect(isLocalEndpoint('http://inference.internal/v1')).toBe(true);
        expect(isLocalEndpoint('http://rig.lan:8080/v1')).toBe(true);
    });

    it('does not treat public hosts as local', () => {
        expect(isLocalEndpoint('https://api.openai.com/v1')).toBe(false);
        expect(isLocalEndpoint('https://openrouter.ai/api/v1')).toBe(false);
        // 172.32 is outside the private 172.16/12 block.
        expect(isLocalEndpoint('http://172.32.0.1:8080/v1')).toBe(false);
        // A hostname that merely contains "localhost" is not loopback.
        expect(isLocalEndpoint('https://localhost.evil.example.com/v1')).toBe(false);
    });

    it('handles empty and malformed input without throwing', () => {
        expect(isLocalEndpoint('')).toBe(false);
        expect(isLocalEndpoint(null)).toBe(false);
        expect(isLocalEndpoint(undefined)).toBe(false);
        expect(isLocalEndpoint(42)).toBe(false);
        // A half-typed URL should still read as local while the user types.
        expect(isLocalEndpoint('localhost:11434')).toBe(true);
    });
});

describe('requiresApiKey', () => {
    it('is false for every local runner, which is the whole point', () => {
        expect(requiresApiKey('http://localhost:11434/v1')).toBe(false); // Ollama
        expect(requiresApiKey('http://localhost:1234/v1')).toBe(false);  // LM Studio
        expect(requiresApiKey('http://localhost:8080/v1')).toBe(false);  // llama.cpp
        expect(requiresApiKey(WEBLLM_PROVIDER)).toBe(false);
    });

    it('is true for hosted providers', () => {
        expect(requiresApiKey('https://api.openai.com/v1')).toBe(true);
        expect(requiresApiKey('https://api.groq.com/openai/v1')).toBe(true);
    });
});

describe('provider catalogue', () => {
    it('includes the local runners as first-class entries', () => {
        const ids = PROVIDERS.map(p => p.id);
        expect(ids).toContain('http://localhost:11434/v1'); // Ollama
        expect(ids).toContain('http://localhost:1234/v1');  // LM Studio
        expect(ids).toContain(WEBLLM_PROVIDER);
    });

    it('marks local providers as keyless and gives them setup hints', () => {
        PROVIDERS.filter(p => p.local).forEach(provider => {
            expect(provider.requiresKey).toBe(false);
            expect(provider.hint).toBeTruthy();
        });
    });

    it('resolves providers by id and returns null for unknown ones', () => {
        expect(getProvider('http://localhost:11434/v1').label).toContain('Ollama');
        expect(getProvider('nope')).toBeNull();
    });
});

describe('endpoint normalisation', () => {
    it('appends the chat path exactly once', () => {
        expect(getApiEndpoint('http://localhost:11434/v1')).toBe('http://localhost:11434/v1/chat/completions');
        expect(getApiEndpoint('http://localhost:11434/v1/')).toBe('http://localhost:11434/v1/chat/completions');
        expect(getApiEndpoint('  http://localhost:11434/v1///  ')).toBe('http://localhost:11434/v1/chat/completions');
        expect(getApiEndpoint('http://x/v1/chat/completions')).toBe('http://x/v1/chat/completions');
    });

    it('appends the models path exactly once', () => {
        expect(getModelsEndpoint('http://localhost:11434/v1')).toBe('http://localhost:11434/v1/models');
        expect(getModelsEndpoint('http://localhost:11434/v1/models')).toBe('http://localhost:11434/v1/models');
    });
});

describe('buildHeaders', () => {
    it('omits Authorization when there is no key', () => {
        expect(buildHeaders('')).toEqual({ 'Content-Type': 'application/json' });
        expect(buildHeaders('   ')).toEqual({ 'Content-Type': 'application/json' });
        expect(buildHeaders(undefined)).toEqual({ 'Content-Type': 'application/json' });
    });

    it('includes a bearer token when a key is given', () => {
        expect(buildHeaders('sk-abc').Authorization).toBe('Bearer sk-abc');
    });
});

describe('error messages', () => {
    it('names the likely CORS fix for a failed local connection', () => {
        const ollama = describeConnectionError(new Error('Failed to fetch'), 'http://localhost:11434/v1');
        expect(ollama).toContain('OLLAMA_ORIGINS');

        const lmStudio = describeConnectionError(new Error('Failed to fetch'), 'http://localhost:1234/v1');
        expect(lmStudio).toContain('LM Studio');
    });

    it('keeps remote failures generic', () => {
        const msg = describeConnectionError(new Error('Failed to fetch'), 'https://api.openai.com/v1');
        expect(msg).toContain('Network error');
    });

    it('turns HTTP statuses into actionable text', async () => {
        const unauthorized = await describeHttpError(new Response('{"error":{"message":"bad key"}}', { status: 401 }));
        expect(unauthorized).toContain('Unauthorized (401)');
        expect(unauthorized).toContain('bad key');

        const notFound = await describeHttpError(new Response('', { status: 404 }));
        expect(notFound).toContain('/v1');

        const limited = await describeHttpError(new Response('', { status: 429 }));
        expect(limited).toContain('Rate limited (429)');
    });
});

describe('mixedContentWarning', () => {
    const original = window.location;

    afterEach(() => {
        Object.defineProperty(window, 'location', { value: original, configurable: true, writable: true });
    });

    it('warns when an https page targets an http local server', () => {
        Object.defineProperty(window, 'location', {
            value: { protocol: 'https:', origin: 'https://example.com' },
            configurable: true, writable: true
        });
        expect(mixedContentWarning('http://localhost:11434/v1')).toContain('HTTPS');
    });

    it('stays quiet on an http page', () => {
        Object.defineProperty(window, 'location', {
            value: { protocol: 'http:', origin: 'http://localhost:5173' },
            configurable: true, writable: true
        });
        expect(mixedContentWarning('http://localhost:11434/v1')).toBeNull();
    });
});

describe('fetchProviderModels', () => {
    beforeEach(() => server.resetHandlers());

    it('reads an OpenAI-shaped list and returns plain ids', async () => {
        server.use(http.get('http://localhost:11434/v1/models', () =>
            HttpResponse.json({ data: [{ id: 'llama3.1:8b' }, { id: 'qwen2.5-coder:7b' }] })));

        await expect(fetchProviderModels('http://localhost:11434/v1', ''))
            .resolves.toEqual(['llama3.1:8b', 'qwen2.5-coder:7b']);
    });

    it('accepts the alternative "models" key and bare strings', async () => {
        server.use(http.get('http://localhost:8080/v1/models', () =>
            HttpResponse.json({ models: ['local-model'] })));

        await expect(fetchProviderModels('http://localhost:8080/v1', ''))
            .resolves.toEqual(['local-model']);
    });

    it('rejects an empty list with an explanation', async () => {
        server.use(http.get('http://localhost:11434/v1/models', () => HttpResponse.json({ data: [] })));
        await expect(fetchProviderModels('http://localhost:11434/v1', '')).rejects.toThrow('No models found');
    });

    it('sends no Authorization header when there is no key', async () => {
        let sawAuth = 'unset';
        server.use(http.get('http://localhost:11434/v1/models', ({ request }) => {
            sawAuth = request.headers.get('authorization');
            return HttpResponse.json({ data: [{ id: 'm' }] });
        }));

        await fetchProviderModels('http://localhost:11434/v1', '');
        expect(sawAuth).toBeNull();
    });
});

describe('testConnection', () => {
    beforeEach(() => server.resetHandlers());

    it('refuses to probe with no URL', async () => {
        await expect(testConnection('', '')).resolves.toMatchObject({ ok: false });
    });

    it('requires a key only for hosted providers', async () => {
        const result = await testConnection('https://api.openai.com/v1', '');
        expect(result.ok).toBe(false);
        expect(result.message).toContain('API key');
    });

    it('reports success and the model count for a keyless local server', async () => {
        server.use(http.get('http://localhost:11434/v1/models', () =>
            HttpResponse.json({ data: [{ id: 'a' }, { id: 'b' }] })));

        const result = await testConnection('http://localhost:11434/v1', '');
        expect(result.ok).toBe(true);
        expect(result.models).toEqual(['a', 'b']);
        expect(result.message).toContain('2 models');
        expect(result.message).toContain('local server');
    });

    it('never throws — a failure comes back as a result', async () => {
        server.use(http.get('http://localhost:9999/v1/models', () => HttpResponse.error()));
        const result = await testConnection('http://localhost:9999/v1', '');
        expect(result.ok).toBe(false);
        expect(typeof result.message).toBe('string');
    });
});
