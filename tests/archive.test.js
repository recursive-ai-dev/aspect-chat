import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { readBoundedArchive, MAX_ARCHIVE_BYTES, MAX_ARCHIVE_ENTRY_BYTES, MAX_ARCHIVE_ENTRIES } from '../src/js/modules/archive.js';

// Large real ZIP boundaries also run under coverage while an emulator is active.
// Allow instrumentation overhead without reducing payloads or assertions.
const STRESS_TIMEOUT = 30_000;

const compressed = async zip => JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));

describe('bounded real ZIP extraction', () => {
    it('handles exact per-entry boundary and UTF-8/binary values', async () => {
        const zip = new JSZip().file('boundary.txt', 'x'.repeat(MAX_ARCHIVE_ENTRY_BYTES)).file('unicode.txt', '人物 🌲').file('binary.png', new Uint8Array([0, 255, 128]));
        const archive = await readBoundedArchive(await compressed(zip));
        expect(archive.text('boundary.txt')).toHaveLength(MAX_ARCHIVE_ENTRY_BYTES);
        expect(archive.text('unicode.txt')).toBe('人物 🌲');
        expect(archive.base64('binary.png')).toBe('AP+A');
        expect(archive.text('absent')).toBeNull();
    }, STRESS_TIMEOUT);

    it('rejects a highly compressed oversized entry before inflation', async () => {
        const zip = await compressed(new JSZip().file('bomb.txt', 'x'.repeat(MAX_ARCHIVE_ENTRY_BYTES + 1)));
        const entry = zip.file('bomb.txt');
        expect(entry._data.compressedSize).toBeLessThan(20000);
        await expect(readBoundedArchive(zip)).rejects.toThrow('15MB');
    });

    it('checks actual expanded bytes even when declared lengths lie', async () => {
        const zip = new JSZip().file('bomb.txt', 'x'.repeat(MAX_ARCHIVE_ENTRY_BYTES + 1));
        // An in-memory ZipObject has no trusted uncompressed-size header.
        await expect(readBoundedArchive(zip)).rejects.toThrow('Expanded archive exceeds');
    });

    it('enforces aggregate limits across individually valid entries', async () => {
        const zip = new JSZip();
        for (let i = 0; i < 4; i++) zip.file(`part-${i}`, 'x'.repeat(MAX_ARCHIVE_ENTRY_BYTES));
        await expect(readBoundedArchive(await compressed(zip))).rejects.toThrow('50MB');
    }, STRESS_TIMEOUT);

    it('allows exact aggregate boundaries', async () => {
        const zip = new JSZip();
        for (let i = 0; i < 3; i++) zip.file(`part-${i}`, 'x'.repeat(MAX_ARCHIVE_ENTRY_BYTES));
        zip.file('last', 'x'.repeat(MAX_ARCHIVE_BYTES - 3 * MAX_ARCHIVE_ENTRY_BYTES));
        const archive = await readBoundedArchive(zip);
        expect(archive.paths).toHaveLength(4);
        expect(archive.text('last')).toHaveLength(5 * 1024 * 1024);
    }, STRESS_TIMEOUT);

    it('bounds entry count, counting directories and empty files', async () => {
        const zip = new JSZip();
        for (let i = 0; i < MAX_ARCHIVE_ENTRIES; i++) zip.file(String(i), '');
        expect((await readBoundedArchive(zip)).paths).toHaveLength(MAX_ARCHIVE_ENTRIES);
        zip.file('excess', '');
        await expect(readBoundedArchive(zip)).rejects.toThrow('too many entries');
    }, STRESS_TIMEOUT);

    it('rejects traversal, absolute and colliding normalized paths', async () => {
        for (const path of ['../outside.txt', '/absolute.txt', 'C:\\file.txt', 'bad\0name']) {
            await expect(readBoundedArchive(new JSZip().file(path, 'bad'))).rejects.toThrow('unsafe');
        }
        await expect(readBoundedArchive(new JSZip().file('one/file.txt', 'a').file('one\\file.txt', 'b'))).rejects.toThrow('duplicate');
        const sanitized = await compressed(new JSZip().file('../secret', 'bad'));
        await expect(readBoundedArchive(sanitized)).rejects.toThrow('unsafe');
    });
});
