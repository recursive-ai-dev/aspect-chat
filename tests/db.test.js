import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { saveKnowledgeFile, getKnowledgeFilesRaw, getKnowledgeFilesText, uploadKnowledgeFiles } from '../src/js/modules/db.js';
import * as aspects from '../src/js/modules/aspects.js';

// Mock the get-current aspect function
vi.mock('../src/js/modules/aspects.js', () => ({
    getCurrentAspect: vi.fn(),
    updateAspectData: vi.fn()
}));

// We need to mock pdfjsLib and mammoth that are imported in db.js
vi.mock('pdfjs-dist', () => ({
    getDocument: vi.fn(),
    GlobalWorkerOptions: { workerSrc: '' }
}));
vi.mock('mammoth', () => ({
    extractRawText: vi.fn()
}));

describe('Database and Cache module - saveKnowledgeFile', () => {
    it('should save a new knowledge file', async () => {
        const aspectId = 'test-aspect-1';
        const name = 'test-file.txt';
        const text = 'This is a test file.';

        await saveKnowledgeFile(aspectId, name, text);

        const files = await getKnowledgeFilesRaw(aspectId);
        expect(files.length).toBe(1);
        expect(files[0].aspectId).toBe(aspectId);
        expect(files[0].name).toBe(name);
        expect(files[0].text).toBe(text);
    });

    it('should update an existing knowledge file', async () => {
        const aspectId = 'test-aspect-2';
        const name = 'test-file.txt';
        const text1 = 'This is a test file.';
        const text2 = 'This is the updated test file.';

        await saveKnowledgeFile(aspectId, name, text1);
        await saveKnowledgeFile(aspectId, name, text2);

        const files = await getKnowledgeFilesRaw(aspectId);
        expect(files.length).toBe(1);
        expect(files[0].text).toBe(text2);
    });

    it('should initialize cache with existing files', async () => {
        const aspectId = 'test-aspect-init';
        await saveKnowledgeFile(aspectId, 'init.txt', 'init');
        
        // Reset cache so initCache will run again and fetch the file we just saved
        const { resetCacheForTesting } = await import('../src/js/modules/db.js');
        resetCacheForTesting();

        const files = await getKnowledgeFilesRaw(aspectId);
        expect(files.length).toBe(1);
        expect(files[0].name).toBe('init.txt');
    });

    it('should correctly format text for getKnowledgeFilesText', async () => {
        const aspectId = 'test-aspect-3';
        await saveKnowledgeFile(aspectId, 'file1.txt', 'Content 1');
        await saveKnowledgeFile(aspectId, 'file2.txt', 'Content 2');

        const formattedText = await getKnowledgeFilesText(aspectId);
        expect(formattedText).toContain('--- Start of File: file1.txt ---');
        expect(formattedText).toContain('Content 1');
        expect(formattedText).toContain('--- End of File: file1.txt ---');
        expect(formattedText).toContain('--- Start of File: file2.txt ---');
        expect(formattedText).toContain('Content 2');
        expect(formattedText).toContain('--- End of File: file2.txt ---');
    });

    it('should cover getKnowledgeFilesText empty array', async () => {
        // Use a unique aspect ID to ensure empty cache
        const text = await getKnowledgeFilesText('empty-aspect-no-files');
        expect(text).toBe('');
    });
});

describe('Database and Cache module - Memory', () => {
    it('should save and retrieve memory object', async () => {
        const { saveMemory, getMemory } = await import('../src/js/modules/db.js');
        const aspectId = 'memory-test-aspect';
        const memory = { key: 'value', count: 5 };

        await saveMemory(aspectId, memory);
        const retrieved = await getMemory(aspectId);

        expect(retrieved).toEqual(memory);
    });

    it('should return empty object if memory does not exist', async () => {
        const { getMemory } = await import('../src/js/modules/db.js');
        const retrieved = await getMemory('nonexistent');
        expect(retrieved).toEqual({});
    });
});

describe('Database and Cache module - uploadKnowledgeFiles', () => {
    let originalShowToast;
    let originalConsoleError;

    beforeEach(() => {
        // Mock global showToast and console.error
        originalShowToast = window.showToast;
        window.showToast = vi.fn();

        originalConsoleError = console.error;
        console.error = vi.fn();

        // Setup mock aspect
        aspects.getCurrentAspect.mockReturnValue({ id: 'test-upload-aspect' });
    });

    afterEach(() => {
        // Restore globals
        window.showToast = originalShowToast;
        console.error = originalConsoleError;
        vi.clearAllMocks();
    });

    it('should handle exceptions during file processing and show toast', async () => {
        // Create a mock file where reading text throws an error
        const mockFile = {
            name: 'error-file.txt',
            text: vi.fn().mockRejectedValue(new Error('Simulated read error'))
        };

        const mockEvent = {
            target: {
                files: [mockFile]
            }
        };

        await uploadKnowledgeFiles(mockEvent);

        // Verify the error was caught and logged/shown.
        // Since the batch refactor, processing errors are reported as save errors
        // (the file never reaches the batch so the message uses "Failed to save").
        expect(console.error).toHaveBeenCalledWith(
            "Error processing file",
            "error-file.txt",
            expect.any(Error)
        );
        expect(window.showToast).toHaveBeenCalledWith(
            "Failed to save error-file.txt: Simulated read error",
            "error"
        );
    });

    it('should successfully upload multiple supported file types and update UI', async () => {
        // Setup mock inputs in DOM
        document.body.innerHTML = '<textarea id="edit-knowledge">Old Knowledge</textarea>';
        const mockEvent = {
            target: {
                files: [
                    { name: 'test.txt', text: vi.fn().mockResolvedValue('text content') },
                    { name: 'test.md', text: vi.fn().mockResolvedValue('md content') },
                    { name: 'test.pdf', arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)) },
                    { name: 'test.docx', arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)) },
                    { name: 'test.unknown' }
                ],
                value: 'some-value'
            }
        };

        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.getDocument.mockReturnValue({
            promise: Promise.resolve({
                numPages: 1,
                getPage: vi.fn().mockResolvedValue({
                    getTextContent: vi.fn().mockResolvedValue({ items: [{ str: 'pdf content' }] })
                })
            })
        });

        const mammoth = await import('mammoth');
        mammoth.extractRawText.mockResolvedValue({ value: 'docx content' });

        await uploadKnowledgeFiles(mockEvent);

        expect(window.showToast).toHaveBeenCalledWith('Unsupported file type: unknown', 'error');
        expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('Attached 4 file(s)'));
        expect(mockEvent.target.value).toBe('');

        // Uploading must not rewrite the user's own Knowledge prompt. Attached
        // files are injected into context automatically and listed in the editor.
        const knInput = document.getElementById('edit-knowledge');
        expect(knInput.value).toBe('Old Knowledge');
        expect(aspects.updateAspectData).not.toHaveBeenCalled();
    });

    it('should catch error when saveKnowledgeFileBatch fails', async () => {
        // Intercept IDBObjectStore.put to simulate a storage failure.
        // The new batch implementation catches errors at the batch level.
        const originalPut = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = vi.fn().mockImplementation(function (...args) {
            IDBObjectStore.prototype.put = originalPut; // Restore immediately.
            throw new Error('Simulated IDB error');
        });

        const mockEvent = {
            target: {
                files: [
                    { name: 'test.txt', text: vi.fn().mockResolvedValue('valid text') }
                ],
                value: 'some-value'
            }
        };

        await uploadKnowledgeFiles(mockEvent);

        // The batch refactor logs at the batch level, not per-file.
        expect(console.error).toHaveBeenCalledWith(
            "Error saving knowledge file batch",
            expect.any(Error)
        );
        expect(window.showToast).toHaveBeenCalledWith(
            expect.stringContaining("Simulated IDB error"),
            "error"
        );
    });

    it('should reject files exceeding MAX_KNOWLEDGE_FILE_SIZE (15MB)', async () => {
        const mockEvent = {
            target: {
                files: [
                    { name: 'huge.txt', size: 16 * 1024 * 1024, text: vi.fn() }
                ],
                value: 'some-value'
            }
        };
        await uploadKnowledgeFiles(mockEvent);
        expect(window.showToast).toHaveBeenCalledWith(
            'File "huge.txt" exceeds the maximum allowed size of 15MB.',
            'error'
        );
    });

    it('should warn when a file has empty or whitespace-only content', async () => {
        const mockEvent = {
            target: {
                files: [
                    { name: 'blank.txt', size: 10, text: vi.fn().mockResolvedValue('   \n  ') }
                ],
                value: 'some-value'
            }
        };
        await uploadKnowledgeFiles(mockEvent);
        expect(window.showToast).toHaveBeenCalledWith(
            'File "blank.txt" contains no readable text or is empty.',
            'warning'
        );
    });

    it('should handle files without an extension', async () => {
        const mockEvent = {
            target: {
                files: [
                    { name: 'LICENSE', size: 100 }
                ],
                value: 'some-value'
            }
        };
        await uploadKnowledgeFiles(mockEvent);
        expect(window.showToast).toHaveBeenCalledWith(
            'Unsupported file type: (none)',
            'error'
        );
    });

    it('should call pdf.destroy after extracting pdf content', async () => {
        const destroyMock = vi.fn();
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.getDocument.mockReturnValueOnce({
            promise: Promise.resolve({
                numPages: 1,
                getPage: vi.fn().mockResolvedValue({
                    getTextContent: vi.fn().mockResolvedValue({ items: [{ str: 'page text' }] })
                }),
                destroy: destroyMock
            })
        });

        const mockEvent = {
            target: {
                files: [
                    { name: 'document.pdf', size: 1024, arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)) }
                ],
                value: 'some-value'
            }
        };

        await uploadKnowledgeFiles(mockEvent);
        expect(destroyMock).toHaveBeenCalled();
    });

    it('should reconnect dynamically after resetDatabaseForTesting', async () => {
        const { resetDatabaseForTesting } = await import('../src/js/modules/idb.js');
        const { saveMemory, getMemory } = await import('../src/js/modules/db.js');
        await resetDatabaseForTesting();
        await saveMemory('reconnect-aspect', { test: true });
        const mem = await getMemory('reconnect-aspect');
        expect(mem).toEqual({ test: true });
    });
});

