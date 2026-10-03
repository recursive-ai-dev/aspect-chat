import { getCurrentAspect } from './aspects.js';

import { getDB } from './idb.js';

// pdf.js (~350 KB) and mammoth (~250 KB) are only needed when a user attaches a
// PDF or .docx. Load them on first use so they stay out of the initial bundle.
let pdfjsPromise = null;
function loadPdfjs() {
    if (!pdfjsPromise) {
        pdfjsPromise = import('pdfjs-dist').then((pdfjsLib) => {
            pdfjsLib.GlobalWorkerOptions.workerSrc =
                new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();
            return pdfjsLib;
        });
    }
    return pdfjsPromise;
}
function loadMammoth() {
    return import('mammoth');
}

// The database connection (including the Aspect store) lives in idb.js
// so there is a single schema-upgrade handler for the whole app.
export const MAX_KNOWLEDGE_FILE_SIZE = 15 * 1024 * 1024; // 15 MB

/**
 * Return a subset of a memory object whose keys start with `prefix/` or
 * exactly equal `prefix`, with the prefix (and trailing slash) stripped.
 *
 * E.g. getMemoryNamespace({ "projects/app/todos": [1,2] }, "projects/app")
 *      → { "todos": [1,2] }
 *
 * @param {Object} memory  The full memory object for an Aspect.
 * @param {string} prefix  Namespace prefix, e.g. "projects/myapp".
 * @returns {Object}
 */
export function getMemoryNamespace(memory, prefix) {
    if (!memory || typeof memory !== 'object') return {};
    if (!prefix || typeof prefix !== 'string') return {};
    const normalized = prefix.endsWith('/') ? prefix : prefix + '/';
    const result = {};
    for (const key of Object.keys(memory)) {
        if (key.startsWith(normalized)) {
            result[key.slice(normalized.length)] = memory[key];
        }
    }
    return result;
}

/**
 * Return a sorted array of keys in a memory object, optionally filtered to
 * only keys that start with `prefix`.
 *
 * @param {Object} memory   The full memory object for an Aspect.
 * @param {string} [prefix] Optional namespace prefix to filter by.
 * @returns {string[]}
 */
export function listMemoryKeys(memory, prefix) {
    if (!memory || typeof memory !== 'object') return [];
    const keys = Object.keys(memory);
    const filtered = prefix
        ? keys.filter(k => k.startsWith(prefix))
        : keys;
    return filtered.sort();
}

export async function saveMemory(aspectId, memoryObj) {
    if (!aspectId) return;
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('memory', 'readwrite');
        tx.objectStore('memory').put({ aspectId, memory: memoryObj });
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    });
}

export async function getMemory(aspectId) {
    if (!aspectId) return {};
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('memory', 'readonly');
        const store = tx.objectStore('memory');
        const request = store.get(aspectId);
        request.onsuccess = () => {
            resolve(request.result ? request.result.memory : {});
        };
        request.onerror = (e) => reject(e.target.error);
    });
}


// In-memory cache for performance
let knowledgeCache = {}; // aspectId -> Array of file objects
let isCacheInitialized = false;
let initCachePromise = null;

async function initCache() {
    if (isCacheInitialized) return;
    if (initCachePromise) return initCachePromise;

    initCachePromise = (async () => {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('files', 'readonly');
            const store = tx.objectStore('files');
            const request = store.getAll();
            request.onsuccess = () => {
                knowledgeCache = {};
                request.result.forEach(f => {
                    if (!knowledgeCache[f.aspectId]) knowledgeCache[f.aspectId] = [];
                    knowledgeCache[f.aspectId].push(f);
                });
                isCacheInitialized = true;
                initCachePromise = null;
                resolve();
            };
            request.onerror = (e) => {
                initCachePromise = null;
                reject(e.target.error);
            };
        });
    })();
    return initCachePromise;
}

export function resetCacheForTesting() {
    isCacheInitialized = false;
    knowledgeCache = {};
    initCachePromise = null;
}

export async function saveKnowledgeFile(aspectId, name, text) {
    if (!aspectId || !name) return;
    await initCache();
    const db = await getDB();

    // Sync with DB and update cache ONLY on success
    return new Promise((resolve, reject) => {
        const tx = db.transaction('files', 'readwrite');
        tx.objectStore('files').put({ aspectId, name, text });
        tx.oncomplete = () => {
            if (!knowledgeCache[aspectId]) knowledgeCache[aspectId] = [];
            const existingIdx = knowledgeCache[aspectId].findIndex(f => f.name === name);
            if (existingIdx !== -1) {
                knowledgeCache[aspectId][existingIdx].text = text;
            } else {
                knowledgeCache[aspectId].push({ aspectId, name, text });
            }
            resolve();
        };
        tx.onerror = (e) => reject(e.target.error);
    });
}

/**
 * Write multiple knowledge file entries in a single IndexedDB transaction.
 *
 * Batching eliminates the per-chunk transaction overhead that `saveKnowledgeFile`
 * incurs when called in a loop — for large multi-page PDFs the difference is
 * an order of magnitude. On quota failure the entire batch is rolled back
 * atomically, so the store is never left in a half-written state (F-03).
 *
 * @param {Array<{aspectId: string, name: string, text: string}>} entries
 */
export async function saveKnowledgeFileBatch(entries) {
    if (!entries || entries.length === 0) return;
    await initCache();
    const db = await getDB();

    return new Promise((resolve, reject) => {
        const tx = db.transaction('files', 'readwrite');
        const store = tx.objectStore('files');

        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Knowledge batch transaction aborted'));
        tx.oncomplete = () => {
            // Update the in-memory cache only after the transaction commits.
            for (const { aspectId, name, text } of entries) {
                if (!knowledgeCache[aspectId]) knowledgeCache[aspectId] = [];
                const idx = knowledgeCache[aspectId].findIndex(f => f.name === name);
                if (idx !== -1) {
                    knowledgeCache[aspectId][idx].text = text;
                } else {
                    knowledgeCache[aspectId].push({ aspectId, name, text });
                }
            }
            resolve();
        };

        try {
            for (const { aspectId, name, text } of entries) {
                if (!aspectId || !name || typeof text !== 'string') throw new TypeError('Invalid knowledge entry');
                store.put({ aspectId, name, text });
            }
        } catch (error) {
            tx.abort();
            reject(error);
        }
    });
}

export async function getKnowledgeFilesRaw(aspectId) {
    if (!aspectId) return [];
    await initCache();
    return knowledgeCache[aspectId] || [];
}

export async function getKnowledgeFilesText(aspectId) {
    if (!aspectId) return "";
    await initCache();
    const files = knowledgeCache[aspectId] || [];
    if (files.length === 0) {
        return "";
    }
    return files.map(f => `\n\n--- Start of File: ${f.name} ---\n${f.text}\n--- End of File: ${f.name} ---`).join('\n');
}


export async function uploadKnowledgeFiles(event) {
    const files = event?.target?.files;
    if (!files || files.length === 0) return;
    const aspect = getCurrentAspect();
    if (!aspect) return;

    // Accumulate successfully processed entries so they can be written in a
    // single batched IndexedDB transaction (F-03), eliminating per-chunk
    // transaction serialisation overhead on large multi-page PDFs.
    const batchEntries = [];
    const errors = [];

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file || !file.name) continue;

        if (Number.isFinite(file.size) && file.size > MAX_KNOWLEDGE_FILE_SIZE) {
            window.showToast(`File "${file.name}" exceeds the maximum allowed size of 15MB.`, "error");
            continue;
        }

        const dotIdx = file.name.lastIndexOf('.');
        const ext = dotIdx !== -1 ? file.name.slice(dotIdx + 1).toLowerCase() : '';
        let text = '';
        try {
            if (ext === 'txt' || ext === 'md') {
                text = await file.text();
            } else if (ext === 'pdf') {
                const pdfjsLib = await loadPdfjs();
                const arrayBuffer = await file.arrayBuffer();
                const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                try {
                    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                        const page = await pdf.getPage(pageNum);
                        const textContent = await page.getTextContent();
                        const pageText = textContent.items.map(item => item.str).join(' ');
                        text += pageText + '\n';
                    }
                } finally {
                    if (pdf && typeof pdf.destroy === 'function') {
                        await pdf.destroy();
                    }
                }
            } else if (ext === 'docx') {
                const mammoth = await loadMammoth();
                const arrayBuffer = await file.arrayBuffer();
                const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
                text = result.value || '';
            } else {
                window.showToast(`Unsupported file type: ${ext || '(none)'}`, "error");
                continue;
            }

            if (text && text.trim().length > 0) {
                batchEntries.push({ aspectId: aspect.id, name: file.name, text });
            } else {
                window.showToast(`File "${file.name}" contains no readable text or is empty.`, "warning");
            }
        } catch (e) {
            console.error("Error processing file", file.name, e);
            errors.push({ name: file.name, message: e.message });
        }
    }

    // Persist all successfully extracted files in one transaction.
    if (batchEntries.length > 0) {
        try {
            await saveKnowledgeFileBatch(batchEntries);
        } catch (e) {
            console.error("Error saving knowledge file batch", e);
            for (const entry of batchEntries) {
                errors.push({ name: entry.name, message: e.message });
            }
            batchEntries.length = 0; // nothing was committed
        }
    }

    // Report per-file save errors that were caught above.
    for (const { name, message } of errors) {
        window.showToast(`Failed to save ${name}: ${message}`, "error");
    }

    if (batchEntries.length > 0) {
        window.showToast(`Attached ${batchEntries.length} file(s) to this Aspect's knowledge.`);
        if (typeof window.renderKnowledgeFileList === 'function') {
            window.renderKnowledgeFileList();
        }
    }
    if (event.target) {
        event.target.value = '';
    }
}

export async function deleteKnowledgeFile(aspectId, name) {
    if (!aspectId || !name) return;
    await initCache();
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['files', 'vectors'], 'readwrite');
        tx.objectStore('files').delete([aspectId, name]);
        const vectors = tx.objectStore('vectors');
        vectors.index('aspectId').openCursor(IDBKeyRange.only(aspectId)).onsuccess = (e) => {
            const cursor = e.target.result;
            if (!cursor) return;
            if (cursor.value.name === name) cursor.delete();
            cursor.continue();
        };
        tx.oncomplete = () => {
            if (knowledgeCache[aspectId]) {
                knowledgeCache[aspectId] = knowledgeCache[aspectId].filter(f => f.name !== name);
            }
            resolve();
        };
        tx.onerror = (e) => reject(e.target.error);
    });
}

export async function deleteAspectData(aspectId) {
    if (!aspectId) return;
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['files', 'memory', 'vectors'], 'readwrite');
        tx.objectStore('vectors').index('aspectId').openCursor(IDBKeyRange.only(aspectId)).onsuccess = (e) => {
            const cursor = e.target.result;
            if (!cursor) return;
            cursor.delete();
            cursor.continue();
        };

        // Delete memory
        const memoryStore = tx.objectStore('memory');
        memoryStore.delete(aspectId);

        // Delete files
        const filesStore = tx.objectStore('files');
        const fileIndex = filesStore.getAll();
        fileIndex.onsuccess = () => {
            if (Array.isArray(fileIndex.result)) {
                fileIndex.result.forEach(f => {
                    if (f.aspectId === aspectId) {
                        filesStore.delete([aspectId, f.name]);
                    }
                });
            }
        };
        fileIndex.onerror = (e) => reject(e.target.error);

        tx.oncomplete = () => {
            if (knowledgeCache && knowledgeCache[aspectId]) {
                delete knowledgeCache[aspectId];
            }
            resolve();
        };
        tx.onerror = (e) => reject(e.target.error);
    });
}
