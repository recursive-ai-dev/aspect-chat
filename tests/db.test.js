import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { saveKnowledgeFile, getKnowledgeFilesRaw, getKnowledgeFilesText } from '../src/js/modules/db.js';

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
