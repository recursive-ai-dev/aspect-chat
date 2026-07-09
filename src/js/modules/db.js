import { getCurrentAspect } from './aspects.js';
import { updateAspectData } from './aspects.js';
import * as pdfjsLib from 'pdfjs-dist';
import * as mammoth from 'mammoth';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();


        let dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open('AspectKnowledgeDB', 1);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('files')) {
                    db.createObjectStore('files', { keyPath: ['aspectId', 'name'] });
                }
            };
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => reject(e.target.error);
        });


        // In-memory cache for performance
        let knowledgeCache = {}; // aspectId -> Array of file objects
        let isCacheInitialized = false;

        async function initCache() {
            if (isCacheInitialized) return;
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
                    resolve();
                };
                request.onerror = (e) => reject(e.target.error);
            });
        }

        export async function saveKnowledgeFile(aspectId, name, text) {
            await initCache();
            const db = await dbPromise;

            // Update cache immediately
            if (!knowledgeCache[aspectId]) knowledgeCache[aspectId] = [];
            const existingIdx = knowledgeCache[aspectId].findIndex(f => f.name === name);
            if (existingIdx !== -1) {
                knowledgeCache[aspectId][existingIdx].text = text;
            } else {
                knowledgeCache[aspectId].push({ aspectId, name, text });
            }

            // Sync with DB
            return new Promise((resolve, reject) => {
                const tx = db.transaction('files', 'readwrite');
                tx.objectStore('files').put({ aspectId, name, text });
                tx.oncomplete = () => resolve();
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

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const ext = file.name.split('.').pop().toLowerCase();
                let text = '';
                try {
                    if (ext === 'txt' || ext === 'md') {
                        text = await file.text();
                    } else if (ext === 'pdf') {
                        const arrayBuffer = await file.arrayBuffer();
                        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                            const page = await pdf.getPage(pageNum);
                            const textContent = await page.getTextContent();
                            const pageText = textContent.items.map(item => item.str).join(' ');
                            text += pageText + '\n';
                        }
                    } else if (ext === 'docx') {
                        const arrayBuffer = await file.arrayBuffer();
                        const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
                        text = result.value;
                    } else {
                        window.showToast(`Unsupported file type: ${ext}`, "error");
                        continue;
                    }
                    
                    if (text) {
                        await saveKnowledgeFile(aspect.id, file.name, text);
                        appendedText += `\nUploaded ${file.name} to internal storage.\n`;
                        processedCount++;
                    }
                } catch (e) {
                    console.error("Error processing file", file.name, e);
                    window.showToast(`Failed to process ${file.name}: ${e.message}`, "error");
                }
            }

            if (processedCount > 0) {
                const knInput = document.getElementById('edit-knowledge');
                knInput.value = knInput.value + `\n\n> Note: ${processedCount} file(s) have been uploaded to internal DOM storage. Their contents will be automatically appended to the context.`;
                updateAspectData('knowledge', knInput.value);
                window.showToast(`Successfully processed and saved ${processedCount} file(s) to internal storage.`);
            }
            event.target.value = '';
        }
