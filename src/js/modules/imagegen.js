/**
 * Icon generation via pollinations.ai — a free, keyless text-to-image service.
 *
 * This is the only outbound request Aspect Studio makes that is not a chat
 * completion to the user's own configured endpoint, and it only fires when the
 * user clicks "Generate icon". The result is fetched and inlined as a data URI
 * so nothing about the Aspect ever depends on an external URL staying alive.
 */

const ENDPOINT = 'https://image.pollinations.ai/prompt/';
const SIZE = 512;
const TIMEOUT_MS = 90_000;

/** Wrap a bare description into an icon-shaped prompt. */
export function buildIconPrompt(description) {
    const subject = (description || '').trim() || 'a serene abstract emblem';
    return `app icon, circular emblem, centered, flat vector illustration, ` +
        `bold clean shapes, limited palette, soft depth, no text, no lettering — ${subject}`;
}

function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read the generated image.'));
        reader.readAsDataURL(blob);
    });
}

/**
 * Generate an icon from `description`. Returns a `data:image/...;base64,...`
 * string. Rejects on network failure, a non-image response, or timeout.
 *
 * @param {string} description  free text; blank is allowed
 * @param {{ seed?: number, signal?: AbortSignal }} [opts]
 */
export async function generateIcon(description, opts = {}) {
    const seed = Number.isFinite(opts.seed) ? opts.seed : Math.floor(Math.random() * 1e9);
    const prompt = buildIconPrompt(description);
    const url = `${ENDPOINT}${encodeURIComponent(prompt)}` +
        `?width=${SIZE}&height=${SIZE}&seed=${seed}&nologo=true`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    if (opts.signal) {
        if (opts.signal.aborted) controller.abort();
        else opts.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    let response;
    try {
        response = await fetch(url, { signal: controller.signal, mode: 'cors' });
    } catch (err) {
        clearTimeout(timer);
        if (err.name === 'AbortError') throw new Error('Image generation timed out or was cancelled.');
        throw new Error('Could not reach the image service. Check your connection and try again.');
    }
    clearTimeout(timer);

    if (!response.ok) {
        throw new Error(`Image service returned ${response.status}. Try a different description.`);
    }
    const type = response.headers.get('content-type') || '';
    if (!type.startsWith('image/')) {
        throw new Error('The image service did not return an image. Try again in a moment.');
    }

    const blob = await response.blob();
    if (!blob.size) throw new Error('The image service returned an empty image.');
    return blobToDataURL(blob);
}
