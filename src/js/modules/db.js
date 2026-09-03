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
        const dbPromise = getDB();

        export async function saveMemory(aspectId, memoryObj) {
            const db = await dbPromise;
            return new Promise((resolve, reject) => {
                const tx = db.transaction('memory', 'readwrite');
                tx.objectStore('memory').put({ aspectId, memory: memoryObj });
                tx.oncomplete = () => resolve();
                tx.onerror = (e) => reject(e.target.error);
            });
        }

        export async function getMemory(aspectId) {
            const db = await dbPromise;
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
                const db = await dbPromise;
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
            await initCache();
            const db = await dbPromise;

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

        export async function getKnowledgeFilesRaw(aspectId) {
            await initCache();
            return knowledgeCache[aspectId] || [];
        }

        export async function getKnowledgeFilesText(aspectId) {
            await initCache();
            const files = knowledgeCache[aspectId] || [];
            if (files.length === 0) {
                return "";
            }
            return files.map(f => `\n\n--- Start of File: ${f.name} ---\n${f.text}\n--- End of File: ${f.name} ---`).join('\n');
        }


        export async function uploadKnowledgeFiles(event) {
            const files = event.target.files;
            if (!files || files.length === 0) return;
            const aspect = getCurrentAspect();
            if (!aspect) return;

            let appendedText = "";
            let processedCount = 0;
            let uploadPromises = [];

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const ext = file.name.split('.').pop().toLowerCase();
                let text = '';
                try {
                    if (ext === 'txt' || ext === 'md') {
                        text = await file.text();
                    } else if (ext === 'pdf') {
                        const pdfjsLib = await loadPdfjs();
                        const arrayBuffer = await file.arrayBuffer();
                        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                            const page = await pdf.getPage(pageNum);
                            const textContent = await page.getTextContent();
                            const pageText = textContent.items.map(item => item.str).join(' ');
                            text += pageText + '\n';
                        }
                    } else if (ext === 'docx') {
                        const mammoth = await loadMammoth();
                        const arrayBuffer = await file.arrayBuffer();
                        const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
                        text = result.value;
                    } else {
                        window.showToast(`Unsupported file type: ${ext}`, "error");
                        continue;
                    }
                    
                    if (text) {
                        uploadPromises.push(
                            saveKnowledgeFile(aspect.id, file.name, text).then(() => {
                                appendedText += `\nUploaded ${file.name} to internal storage.\n`;
                                processedCount++;
                            }).catch((e) => {
                                console.error("Error saving file", file.name, e);
                                window.showToast(`Failed to save ${file.name}: ${e.message}`, "error");
                            })
                        );
                    }
                } catch (e) {
                    console.error("Error processing file", file.name, e);
                    window.showToast(`Failed to process ${file.name}: ${e.message}`, "error");
                }
            }

            await Promise.all(uploadPromises);

            if (processedCount > 0) {
                // The files are attached to the Aspect and injected into context
                // automatically. Previously this also appended a note into the
                // Knowledge textarea on every upload, which slowly filled the
                // user's own prompt with boilerplate; the file list in the
                // editor shows what is attached instead.
                window.showToast(`Attached ${processedCount} file(s) to this Aspect's knowledge.`);
                if (typeof window.renderKnowledgeFileList === 'function') {
                    window.renderKnowledgeFileList();
                }
            }
            event.target.value = '';
        }

export async function deleteKnowledgeFile(aspectId, name) {
    await initCache();
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
        const tx = db.transaction('files', 'readwrite');
        tx.objectStore('files').delete([aspectId, name]);
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
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['files', 'memory'], 'readwrite');

        // Delete memory
        const memoryStore = tx.objectStore('memory');
        memoryStore.delete(aspectId);

        // Delete files
        const filesStore = tx.objectStore('files');
        const fileIndex = filesStore.getAll();
        fileIndex.onsuccess = () => {
            fileIndex.result.forEach(f => {
                if (f.aspectId === aspectId) {
                    filesStore.delete([aspectId, f.name]);
                }
            });
        };

        tx.oncomplete = () => {
            if (knowledgeCache && knowledgeCache[aspectId]) {
                delete knowledgeCache[aspectId];
            }
            resolve();
        };
        tx.onerror = (e) => reject(e.target.error);
    });
}
