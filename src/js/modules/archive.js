/** Bounded ZIP extraction. Limits apply to decoded bytes, including unused entries. */
export const MAX_ARCHIVE_ENTRIES = 1000;
export const MAX_ARCHIVE_ENTRY_BYTES = 15 * 1024 * 1024;
export const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;

function normalizedPath(path) {
    const normalized = path.replace(/\\/g, '/');
    if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || normalized.includes('\0') || normalized.split('/').includes('..')) {
        throw new Error('Archive contains an unsafe entry path.');
    }
    return normalized;
}

function inflateBounded(entry, remaining) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let settled = false;
        const stream = entry.internalStream('uint8array');
        stream.on('data', chunk => {
            if (settled) return;
            size += chunk.byteLength;
            if (size > MAX_ARCHIVE_ENTRY_BYTES || size > remaining) {
                settled = true;
                chunks.length = 0;
                stream.pause();
                reject(new Error('Expanded archive exceeds the size limit.'));
                return;
            }
            chunks.push(chunk);
        });
        stream.on('error', error => {
            if (!settled) { settled = true; chunks.length = 0; reject(error); }
        });
        stream.on('end', () => {
            if (settled) return;
            settled = true;
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
            resolve(bytes);
        });
        stream.resume();
    });
}

function asBase64(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    }
    return btoa(binary);
}

/** Fully validate before callers publish any application or database state. */
export async function readBoundedArchive(zip) {
    const entries = Object.entries(zip.files);
    if (entries.length > MAX_ARCHIVE_ENTRIES) throw new Error('Archive contains too many entries (maximum 1000).');
    let declaredTotal = 0;
    const paths = new Set();
    for (const [name, entry] of entries) {
        const path = normalizedPath(name);
        if (entry.unsafeOriginalName) normalizedPath(entry.unsafeOriginalName);
        if (paths.has(path)) throw new Error('Archive contains duplicate entry paths.');
        paths.add(path);
        const size = entry._data?.uncompressedSize;
        if (size !== undefined) {
            if (!Number.isSafeInteger(size) || size < 0 || size > MAX_ARCHIVE_ENTRY_BYTES) throw new Error('Expanded archive entry exceeds the 15MB size limit.');
            declaredTotal += size;
            if (declaredTotal > MAX_ARCHIVE_BYTES) throw new Error('Expanded archive exceeds the 50MB size limit.');
        }
    }
    // Sequential extraction bounds inflation memory and preserves deterministic order.
    const files = new Map();
    let total = 0;
    for (const [name, entry] of entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
        if (entry.dir) continue;
        const bytes = await inflateBounded(entry, MAX_ARCHIVE_BYTES - total);
        total += bytes.byteLength;
        files.set(normalizedPath(name), bytes);
    }
    const decoder = new TextDecoder();
    return {
        has: path => files.has(path),
        text: path => files.has(path) ? decoder.decode(files.get(path)) : null,
        base64: path => files.has(path) ? asBase64(files.get(path)) : null,
        paths: [...files.keys()]
    };
}
