import { Capacitor, registerPlugin } from '@capacitor/core';

const DocumentExport = registerPlugin('DocumentExport');
export const MAX_EXPORT_BYTES = 50 * 1024 * 1024;
// Multiples of three keep base64 chunks independent and below bridge limits.
const CHUNK_BYTES = 192 * 1024;

function readBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',', 2)[1]);
        reader.onerror = () => reject(reader.error || new Error('Could not read export data.'));
        reader.onabort = () => reject(new Error('Export data read was cancelled.'));
        reader.readAsDataURL(blob);
    });
}

/** Save an export; false means the Android document picker was cancelled. */
export async function saveBlob(blob, filename, mimeType = blob.type || 'application/octet-stream') {
    if (typeof filename !== 'string' || !filename || filename === '.' || filename === '..' || filename.length > 180 || /[\/\\\x00-\x1f\x7f]/.test(filename)) {
        throw new Error('Export filename is invalid.');
    }
    if (Capacitor.getPlatform() === 'android') {
        if (!Number.isSafeInteger(blob.size) || blob.size < 0 || blob.size > MAX_EXPORT_BYTES) {
            throw new Error('Android exports must be at most 50MB.');
        }
        const { token } = await DocumentExport.begin({ filename, mimeType });
        try {
            for (let offset = 0; offset < blob.size; offset += CHUNK_BYTES) {
                const base64 = await readBase64(blob.slice(offset, offset + CHUNK_BYTES));
                await DocumentExport.append({ token, base64 });
            }
            const result = await DocumentExport.save({ token });
            if (typeof result?.cancelled !== 'boolean') throw new Error('Android document provider returned an invalid save result.');
            return !result.cancelled;
        } finally {
            // Idempotent and also cleans up failed bridge/file operations.
            await DocumentExport.discard({ token }).catch(() => {});
        }
    }

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    try {
        anchor.click();
    } finally {
        // Download consumers resolve asynchronously after click dispatch.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return true;
}
