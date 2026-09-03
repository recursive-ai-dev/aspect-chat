import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildIconPrompt, generateIcon } from '../src/js/modules/imagegen.js';

const imageResponse = (type = 'image/png') => ({
    ok: true,
    status: 200,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? type : null) },
    blob: async () => new Blob(['\x89PNG fake bytes'], { type })
});

afterEach(() => {
    vi.restoreAllMocks();
    delete global.fetch;
});

describe('buildIconPrompt', () => {
    it('wraps a description in icon-shaped guidance', () => {
        const p = buildIconPrompt('a wise owl at dusk');
        expect(p).toContain('a wise owl at dusk');
        expect(p.toLowerCase()).toContain('icon');
        expect(p.toLowerCase()).toContain('no text');
    });

    it('uses a fallback subject for blank input', () => {
        expect(buildIconPrompt('   ')).toContain('serene abstract emblem');
    });
});

describe('generateIcon', () => {
    it('returns a base64 data URI on success', async () => {
        global.fetch = vi.fn().mockResolvedValue(imageResponse('image/png'));
        const uri = await generateIcon('a fox', { seed: 42 });
        expect(uri).toMatch(/^data:image\/png;base64,/);

        const calledWith = global.fetch.mock.calls[0][0];
        expect(calledWith).toContain('image.pollinations.ai/prompt/');
        expect(calledWith).toContain('seed=42');
        expect(calledWith).toContain('width=512');
    });

    it('throws a readable error on a non-OK response', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, headers: { get: () => null } });
        await expect(generateIcon('x')).rejects.toThrow(/503/);
    });

    it('throws when the service does not return an image', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true, status: 200,
            headers: { get: () => 'text/html' },
            blob: async () => new Blob(['<html>'], { type: 'text/html' })
        });
        await expect(generateIcon('x')).rejects.toThrow(/did not return an image/);
    });

    it('throws a connection error when fetch itself fails', async () => {
        global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
        await expect(generateIcon('x')).rejects.toThrow(/Could not reach the image service/);
    });
});
