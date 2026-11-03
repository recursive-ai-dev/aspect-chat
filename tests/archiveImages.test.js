import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { addDataImage, addPresetBackground, readArchiveImage } from '../src/js/modules/archiveImages.js';
import { readBoundedArchive } from '../src/js/modules/archive.js';
import { getGenericIcon } from '../src/js/modules/aspects.js';

const images = [
    ['png', 'image/png', readFileSync('android/app/src/main/res/mipmap-mdpi/ic_launcher.png').toString('base64')],
    ['jpeg', 'image/jpeg', readFileSync('public/alone_image_pack/lake_sunset_001.jpeg').toString('base64')],
    ['webp', 'image/webp', 'UklGRp4BAABXRUJQVlA4WAoAAAAQAAAALwAALwAAQUxQSBkAAAABDzD/ERFCadsGTP9/OrwLR/R/AuQP8J09AFZQOCBeAQAA8AkAnQEqMAAwAD6RSJ5LpaQioaOIALASCWIAxPLgPUBtgOeq0wDeaUaBtK5RrcYAT1voPJ8vTz7X9BKf2IbTAq1PpNOyxCc+bHr9IeokglGmt/FgaZSMAAD+/vWxf95ZImEtXAOpzBv0Z/KdVH0VvUXVGEQKACg2RoWaqnV2yvsBjiSMExdxCZk/m3tyUP7TucplqvRAm3BidinePLb3L7OzQsUnnSZgbs1lmTsfVwxU3NPFhy/esJYFss8VSev0sHXAtP3/a/yzh5pWUuTRGxP+f6KzVNcAkLge2ewREYMKupOQEOudqGs4g0ulq6w/5/57UBVx9/P/HaW6wgZ2cIAcWaJw2mD0n3H1d/q/zWwQNCStL92Tl2hOBsOSG1xzT6oQrd3BweJrsO81sc1nrewLRhHpiUOlVzuPeXIt2aHvr8pNkb11WGpUmWrldHTWKlEw6Q92HJgJCDzgAAA=']
];
const compressed = async zip => readBoundedArchive(await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })));

describe('portable archive image formats', () => {
    it.each(images)('preserves actual %s icon/background bytes and MIME through compression', async (extension, mime, base64) => {
        const zip = new JSZip();
        const source = `data:${mime};base64,${base64}`;
        addDataImage(zip, 'Icon', source);
        addDataImage(zip, 'Background', source);
        expect(zip.file(`Icon.${extension}`)).not.toBeNull();
        expect(zip.file(`Background.${extension}`)).not.toBeNull();
        const archive = await compressed(zip);
        expect(readArchiveImage(archive, 'Icon')).toBe(source);
        expect(readArchiveImage(archive, 'Background')).toBe(source);
    });

    it('round-trips the real generic SVG icon without relabeling it PNG', async () => {
        const source = getGenericIcon();
        const zip = new JSZip();
        addDataImage(zip, 'Icon', source);
        expect(zip.file('Icon.svg')).not.toBeNull();
        expect(readArchiveImage(await compressed(zip), 'Icon')).toBe(source);
    });

    it('repairs known legacy mislabeled PNG/JPEG/SVG/WebP exports with bounded signatures', async () => {
        const svg = getGenericIcon();
        const sources = [...images.map(([, mime, base64]) => `data:${mime};base64,${base64}`), svg];
        for (const source of sources) {
            const base64 = source.split(',')[1];
            const zip = new JSZip().file('Icon.png', base64, { base64: true }).file('Background.jpeg', base64, { base64: true });
            const archive = await compressed(zip);
            expect(readArchiveImage(archive, 'Icon')).toBe(source);
            expect(readArchiveImage(archive, 'Background')).toBe(source);
        }
    });

    it('accepts legacy PNG .b64 and .jpg filenames and ignores unrelated markup', async () => {
        const archive = await compressed(new JSZip().file('Icon.b64', images[0][2]).file('Background.jpg', images[1][2], { base64: true }).file('Icon.html', '<script>throw 1</script>'));
        expect(readArchiveImage(archive, 'Icon')).toBe(`data:image/png;base64,${images[0][2]}`);
        expect(readArchiveImage(archive, 'Background')).toBe(`data:image/jpeg;base64,${images[1][2]}`);
        expect(readArchiveImage(await compressed(new JSZip().file('Icon.html', '<script>throw 1</script>')), 'Icon')).toBe('');
    });

    it('rejects unsupported MIME, malformed base64 and malformed legacy .b64 input', async () => {
        const zip = new JSZip();
        for (const source of ['data:text/html;base64,PHNjcmlwdD4=', 'data:image/png;base64,@@@=', 'data:image/png;base64,A', 'https://example.test/image.png']) {
            expect(() => addDataImage(zip, 'Icon', source)).toThrow();
        }
        expect(Object.keys(zip.files)).toEqual([]);
        expect(() => readArchiveImage({ has: p => p === 'Icon.b64', text: () => 'not-base64' }, 'Icon')).toThrow('Invalid legacy');
    });

    it('fetches only local presets, retains their format, and reports missing/unsupported content', async () => {
        const zip = new JSZip();
        const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true, blob: async () => new Blob([Uint8Array.from(atob(images[0][2]), c => c.charCodeAt(0))], { type: 'image/png' }) });
        try {
            await addPresetBackground(zip, 'alone_image_pack/preset.png');
            expect(zip.file('Background.png')).not.toBeNull();
            expect(readArchiveImage(await compressed(zip), 'Background')).toBe(`data:image/png;base64,${images[0][2]}`);
            await expect(addPresetBackground(zip, 'https://untrusted.example/image.png')).rejects.toThrow('bundled');
            expect(fetch).toHaveBeenCalledTimes(1);
            fetch.mockResolvedValueOnce({ ok: false });
            await expect(addPresetBackground(zip, 'missing.png')).rejects.toThrow('Could not load');
            fetch.mockResolvedValueOnce({ ok: true, blob: async () => new Blob(['<html>fallback</html>'], { type: 'text/html' }) });
            await expect(addPresetBackground(zip, 'missing.png')).rejects.toThrow('Unsupported image');
        } finally { fetch.mockRestore(); }
    });
});
