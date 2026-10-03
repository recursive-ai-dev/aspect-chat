import { getKnowledgeFilesRaw } from './db.js';
import { getDB, requestToPromise, withStore } from './idb.js';

const MODEL = 'Xenova/all-MiniLM-L6-v2:q8:chunks-v1';
let worker;
let sequence = 0;
const waiters = new Map();
let warned = false;
export function embedTexts(texts, allowDownloads = false, signal) {
    if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    if (!worker) {
        worker = new Worker(new URL('./embeddingWorker.js', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }) => {
            const waiter = waiters.get(data.id);
            if (!waiter) return;
            waiters.delete(data.id);
            clearTimeout(waiter.timer);
            waiter.detach();
            if (data.error) waiter.reject(new Error(data.error));
            else waiter.resolve(data.vectors);
        };
        worker.onerror = () => resetWorker(new Error('Embedding worker failed'));
    }
    return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => resetWorker(new Error('Embedding model took too long to load')), 120000);
        const abort = () => {
            clearTimeout(timer);
            waiters.delete(id);
            signal?.removeEventListener('abort', abort);
            reject(new DOMException('Aborted', 'AbortError'));
        };
        waiters.set(id, { resolve, reject, timer, detach: () => signal?.removeEventListener('abort', abort) });
        signal?.addEventListener('abort', abort, { once: true });
        worker.postMessage({ id, texts, allowDownloads, modelBase: new URL('models/', document.baseURI).href });
    });
}
function resetWorker(error) {
    worker?.terminate();
    worker = null;
    for (const waiter of waiters.values()) {
        clearTimeout(waiter.timer);
        waiter.detach();
        waiter.reject(error);
    }
    waiters.clear();
}
export function chunkText(text, size = 1000, overlap = 150) {
    if (!Number.isInteger(size) || size <= 0 || overlap < 0 || overlap >= size) throw new Error('Invalid chunk size');
    const chunks = [];
    for (let start = 0; start < text.length; start += size - overlap) {
        chunks.push(text.slice(start, start + size));
        if (start + size >= text.length) break;
    }
    return chunks;
}
export function cosineSimilarity(a, b) {
    if (!a?.length || a.length !== b?.length) return 0;
    let dot = 0, aa = 0, bb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
    return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}
const words = (text) => new Set(String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
export function rankLexically(chunks, query) {
    const terms = words(query);
    return chunks.map(chunk => ({ ...chunk, score: [...words(chunk.text)].filter(word => terms.has(word)).length }))
        .sort((a, b) => b.score - a.score);
}

/** Index lazily so changed/imported notes and files always replace stale chunks. */
export async function retrieveKnowledge(aspect, query, settings = {}, embed = embedTexts, signal) {
    const files = await getKnowledgeFilesRaw(aspect.id);
    const sources = [{ name: '\u0000notes', text: aspect.knowledge || '' }, ...files];
    const chunks = sources.flatMap(file => chunkText(file.text).map((text, chunkIndex) => ({ aspectId: aspect.id, name: file.name, chunkIndex, text })));
    if (!chunks.length) return '';
    let ranked;
    try {
        const db = await getDB();
        const cached = await requestToPromise(db.transaction('vectors').objectStore('vectors').index('aspectId').getAll(aspect.id));
        const missing = [];
        const cacheIndex = new Map(cached.map(row => [JSON.stringify([row.name, row.chunkIndex]), row]));
        for (const chunk of chunks) {
            const old = cacheIndex.get(JSON.stringify([chunk.name, chunk.chunkIndex]));
            if (old && old.text === chunk.text && old.model === MODEL) chunk.vector = old.vector;
            else missing.push(chunk);
        }
        // Bounded batches prevent a large document from monopolizing worker memory.
        for (let start = 0; start < missing.length; start += 16) {
            const batch = missing.slice(start, start + 16);
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            const vectors = await embed(batch.map(chunk => chunk.text), settings.embeddingDownloads, signal);
            batch.forEach((chunk, index) => { chunk.vector = vectors[index]; });
        }
        if (missing.length || cached.length !== chunks.length) {
            await withStore('vectors', 'readwrite', store => {
                cached.forEach(row => store.delete([row.aspectId, row.name, row.chunkIndex]));
                chunks.forEach(chunk => store.put({ ...chunk, model: MODEL }));
            });
        }
        const [queryVector] = await embed([query], settings.embeddingDownloads, signal);
        ranked = chunks.map(chunk => ({ ...chunk, score: cosineSimilarity(chunk.vector, queryVector) })).sort((a, b) => b.score - a.score);
    } catch (error) {
        if (signal?.aborted || error.name === 'AbortError') throw error;
        if (!warned && typeof window.showToast === 'function') {
            warned = true;
            window.showToast('Semantic model unavailable. Using keyword retrieval. Enable embedding downloads or install the model locally in API Settings.', 'warning');
        }
        ranked = rankLexically(chunks, query);
    }
    const k = Math.max(1, Math.min(10, settings.retrievalTopK || 4));
    return ranked.slice(0, k).map(chunk => `\n\n--- ${chunk.name === '\u0000notes' ? 'Knowledge notes' : chunk.name} (chunk ${chunk.chunkIndex + 1}) ---\n${chunk.text}`).join('');
}
