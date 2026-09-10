/**
 * tests/streamDecoder.test.js
 *
 * Verifies F-08: readSSEStream flushes trailing multibyte UTF-8 sequences that
 * span chunk boundaries and arrive without a final newline.
 *
 * The fix is the `decoder.decode()` (no args) call after the read loop, which
 * drains the TextDecoder's internal buffer, followed by a final `consumeLine`
 * call for the trailing `pending` content.
 */

import { describe, it, expect, vi } from 'vitest';
import { readSSEStream } from '../src/js/modules/llm.js';

/** Build a reader that yields raw Uint8Array chunks. */
function rawReader(chunks) {
    let i = 0;
    return {
        read: () => Promise.resolve(
            i < chunks.length
                ? { done: false, value: chunks[i++] }
                : { done: true }
        )
    };
}

/** Build a reader from pre-encoded strings. */
function strReader(strings) {
    const enc = new TextEncoder();
    return rawReader(strings.map(s => enc.encode(s)));
}

const sseData = (content) =>
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

// ─────────────────────────────────────────────────────────────────────────────
describe('F-08 — Multibyte UTF-8 trailing chunk flushing', () => {

    it('flushes a 4-byte emoji (🔥) split across two chunks — no U+FFFD', async () => {
        const encoder = new TextEncoder();
        // 🔥 is U+1F525, encoded as 4 bytes: F0 9F 94 A5
        const fullLine = sseData('Done 🔥');
        const allBytes = encoder.encode(fullLine);

        // Split so the emoji straddles the boundary (last 6 bytes of the line
        // include the last 4 bytes of the emoji plus the trailing \n\n).
        const splitAt = allBytes.length - 6;
        const chunk1 = allBytes.slice(0, splitAt);
        const chunk2 = allBytes.slice(splitAt);

        const received = [];
        const result = await readSSEStream(rawReader([chunk1, chunk2]), d => received.push(d));

        expect(received.join('')).not.toContain('\uFFFD');
        expect(received.join('')).toContain('🔥');
        expect(result).toContain('🔥');
    });

    it('handles a 3-byte char (€) split across chunk boundary', async () => {
        const encoder = new TextEncoder();
        // € is U+20AC, encoded as 3 bytes: E2 82 AC
        const fullLine = sseData('Price: €100');
        const allBytes = encoder.encode(fullLine);

        // Split through the middle of € (2 bytes of it in chunk1, 1 in chunk2)
        const euroStart = allBytes.indexOf(0xE2); // start of €
        const chunk1 = allBytes.slice(0, euroStart + 2); // two bytes of €
        const chunk2 = allBytes.slice(euroStart + 2);

        const received = [];
        await readSSEStream(rawReader([chunk1, chunk2]), d => received.push(d));

        const joined = received.join('');
        expect(joined).not.toContain('\uFFFD');
        expect(joined).toContain('€');
        expect(joined).toContain('Price: €100');
    });

    it('handles a 2-byte char (é) split across chunk boundary', async () => {
        const encoder = new TextEncoder();
        // é is U+00E9, encoded as 2 bytes: C3 A9
        const fullLine = sseData('café');
        const allBytes = encoder.encode(fullLine);

        const eStart = allBytes.indexOf(0xC3); // 'é'
        const chunk1 = allBytes.slice(0, eStart + 1);
        const chunk2 = allBytes.slice(eStart + 1);

        const received = [];
        await readSSEStream(rawReader([chunk1, chunk2]), d => received.push(d));

        const joined = received.join('');
        expect(joined).not.toContain('\uFFFD');
        expect(joined).toContain('café');
    });

    it('handles a stream ending with multibyte char and no final newline', async () => {
        const encoder = new TextEncoder();
        // The SSE line has no trailing \n — the decoder flush must handle it.
        const line = `data: ${JSON.stringify({ choices: [{ delta: { content: '🌸' } }] })}`;
        const allBytes = encoder.encode(line);

        // Split mid-emoji
        const chunk1 = allBytes.slice(0, allBytes.length - 2);
        const chunk2 = allBytes.slice(allBytes.length - 2);

        const received = [];
        await readSSEStream(rawReader([chunk1, chunk2]), d => received.push(d));

        expect(received.join('')).toContain('🌸');
        expect(received.join('')).not.toContain('\uFFFD');
    });

    it('handles the entire SSE payload arriving in a single chunk', async () => {
        const received = [];
        const result = await readSSEStream(
            strReader([sseData('Hello 🌍')]),
            d => received.push(d)
        );

        expect(result).toBe('Hello 🌍');
        expect(received).toEqual(['Hello 🌍']);
    });

    it('handles a multi-emoji message split into many small chunks', async () => {
        const encoder = new TextEncoder();
        const content = '🐱🦊🐧🦋';
        const fullLine = sseData(content);
        const allBytes = encoder.encode(fullLine);

        // Cut into 1-byte pieces to maximise split opportunities.
        const chunks = Array.from(allBytes, b => new Uint8Array([b]));

        const received = [];
        await readSSEStream(rawReader(chunks), d => received.push(d));

        const joined = received.join('');
        expect(joined).not.toContain('\uFFFD');
        expect(joined).toBe(content);
    });

    it('accumulates the full text across split-emoji chunks', async () => {
        const encoder = new TextEncoder();
        const fullLine = [sseData('Part 1 '), sseData('🔥'), sseData(' Part 2')].join('');
        const allBytes = encoder.encode(fullLine);

        // Split in the middle of the emoji chunk
        const splitAt = allBytes.length - 10;
        const chunk1 = allBytes.slice(0, splitAt);
        const chunk2 = allBytes.slice(splitAt);

        const result = await readSSEStream(rawReader([chunk1, chunk2]));
        expect(result).toBe('Part 1 🔥 Part 2');
        expect(result).not.toContain('\uFFFD');
    });

    it('returns empty string for an empty stream', async () => {
        const result = await readSSEStream(rawReader([]));
        expect(result).toBe('');
    });

    it('does not call onDelta for [DONE] sentinel', async () => {
        const received = [];
        await readSSEStream(
            strReader([sseData('text'), 'data: [DONE]\n\n']),
            d => received.push(d)
        );
        expect(received).toEqual(['text']);
    });
});
