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

        // Verify the error was caught and logged/shown
        expect(console.error).toHaveBeenCalledWith(
            "Error processing file",
            "error-file.txt",
            expect.any(Error)
        );
        expect(window.showToast).toHaveBeenCalledWith(
            "Failed to process error-file.txt: Simulated read error",
            "error"
        );
    });
});
