import { MAX_ARCHIVE_ENTRY_BYTES } from './archive.js';

// These formats are rendered only as image sources, never inserted as markup.
const IMAGE_TYPES = [
    ['png', 'image/png'], ['jpeg', 'image/jpeg'], ['jpg', 'image/jpeg'],
    ['webp', 'image/webp'], ['svg', 'image/svg+xml'], ['gif', 'image/gif'],
    ['avif', 'image/avif'], ['bmp', 'image/bmp']
];

function imageType(mime) {
    const normalized = mime.toLowerCase() === 'image/jpg' ? 'image/jpeg' : mime.toLowerCase();
    const match = IMAGE_TYPES.find(([, type]) => type === normalized);
    if (!match) throw new Error('Unsupported image format in Aspect export.');
    return match;
}

/** Preserve data URL bytes/MIME; never disguise arbitrary content as a PNG. */
export function addDataImage(zip, basename, source) {
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(source);
    if (!match || match[2].length % 4 !== 0) throw new Error(`Invalid ${basename.toLowerCase()} image data.`);
    const [extension] = imageType(match[1]);
    const padding = match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0;
    if (match[2].length / 4 * 3 - padding > MAX_ARCHIVE_ENTRY_BYTES) throw new Error('Exported images must be at most 15MB.');
    zip.file(`${basename}.${extension}`, match[2], { base64: true });
}

/** Only bundled, same-origin preset images may be fetched during export. */
export async function addPresetBackground(zip, source) {
    const url = new URL(source, window.location.href);
    if (url.origin !== window.location.origin || !['http:', 'https:'].includes(url.protocol)) {
        throw new Error('Background presets must come from the bundled app.');
    }
    const response = await fetch(url.href);
    if (!response.ok) throw new Error('Could not load the background preset for export.');
    const blob = await response.blob();
    const fallbackType = IMAGE_TYPES.find(([extension]) => url.pathname.toLowerCase().endsWith(`.${extension}`))?.[1];
    const [extension] = imageType(blob.type || fallbackType || '');
    if (blob.size > MAX_ARCHIVE_ENTRY_BYTES) throw new Error('Exported images must be at most 15MB.');
    zip.file(`Background.${extension}`, blob);
}

function repairLegacyMime(base64, fallback) {
    // Older exports called every icon PNG and every background JPEG. Inspect
    // at most 1KiB to recover known signatures without parsing active markup.
    const prefix = atob(base64.slice(0, 1364));
    if (prefix.startsWith('\x89PNG\r\n\x1a\n')) return 'image/png';
    if (prefix.startsWith('\xff\xd8\xff')) return 'image/jpeg';
    if (prefix.startsWith('RIFF') && prefix.slice(8, 12) === 'WEBP') return 'image/webp';
    if (/^GIF8[79]a/.test(prefix)) return 'image/gif';
    if (prefix.startsWith('BM')) return 'image/bmp';
    if (prefix.slice(4, 12) === 'ftypavif') return 'image/avif';
    if (/^(?:\xef\xbb\xbf)?\s*(?:<\?xml[\s\S]*?\?>\s*)?<svg(?:\s|>)/i.test(prefix)) return 'image/svg+xml';
    return fallback;
}

export function readArchiveImage(archive, basename) {
    for (const [extension, declaredType] of IMAGE_TYPES) {
        const path = `${basename}.${extension}`;
        if (!archive.has(path)) continue;
        const base64 = archive.base64(path);
        const mime = repairLegacyMime(base64, declaredType);
        return `data:${mime};base64,${base64}`;
    }
    if (basename === 'Icon' && archive.has('Icon.b64')) {
        const base64 = archive.text('Icon.b64').replace(/\s+/g, '');
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0) throw new Error('Invalid legacy icon image data.');
        return `data:${repairLegacyMime(base64, 'image/png')};base64,${base64}`;
    }
    return '';
}
