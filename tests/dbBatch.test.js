/**
 * tests/dbBatch.test.js
 *
 * Verifies F-03: saveKnowledgeFileBatch writes multiple knowledge chunks in a
 * single IndexedDB transaction, updates the in-memory cache correctly, and
 * rolls back atomically on failure.
 */

import 'fake-indexeddb/auto';
import { getDB, requestToPromise } from '../src/js/modules/idb.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    saveKnowledgeFileBatch,
    saveKnowledgeFile,
    getKnowledgeFilesRaw,
    deleteAspectData,
    resetCacheForTesting
} from '../src/js/modules/db.js';

// db.js imports these; keep them silent during batch tests.
vi.mock('../src/js/modules/aspects.js', () => ({
    getCurrentAspect: vi.fn(),
    updateAspectData: vi.fn()
}));
vi.mock('pdfjs-dist', () => ({
    getDocument: vi.fn(),
    GlobalWorkerOptions: { workerSrc: '' }
}));
vi.mock('mammoth', () => ({ extractRawText: vi.fn() }));

// ─────────────────────────────────────────────────────────────────────────────
describe('saveKnowledgeFileBatch', () => {
    beforeEach(() => {
        resetCacheForTesting();
    });

    it('writes multiple entries and makes them retrievable', async () => {
        const aspectId = 'batch-aspect-1';
        const entries = [
            { aspectId, name: 'file1.txt', text: 'Content of file 1' },
            { aspectId, name: 'file2.txt', text: 'Content of file 2' },
            { aspectId, name: 'file3.md',  text: '# Markdown file' }
        ];

        await saveKnowledgeFileBatch(entries);

        const stored = await getKnowledgeFilesRaw(aspectId);
        expect(stored.length).toBe(3);
        const names = stored.map(f => f.name).sort();
        expect(names).toEqual(['file1.txt', 'file2.txt', 'file3.md']);
    });

    it('updates the in-memory cache so reads do not need another DB trip', async () => {
        const aspectId = 'batch-cache-aspect';
        await saveKnowledgeFileBatch([
            { aspectId, name: 'a.txt', text: 'Alpha' },
            { aspectId, name: 'b.txt', text: 'Beta' }
        ]);

        // Do NOT reset the cache — reads should come from it.
        const files = await getKnowledgeFilesRaw(aspectId);
        expect(files.find(f => f.name === 'a.txt')?.text).toBe('Alpha');
        expect(files.find(f => f.name === 'b.txt')?.text).toBe('Beta');
    });

    it('overwrites an existing entry when the same name is re-batched', async () => {
        const aspectId = 'batch-overwrite';
        await saveKnowledgeFileBatch([{ aspectId, name: 'doc.txt', text: 'v1' }]);
        resetCacheForTesting();
        await saveKnowledgeFileBatch([{ aspectId, name: 'doc.txt', text: 'v2' }]);

        const files = await getKnowledgeFilesRaw(aspectId);
        expect(files.length).toBe(1);
        expect(files[0].text).toBe('v2');
    });

    it('handles a large batch (50 entries) without error', async () => {
        const aspectId = 'batch-large';
        const entries = Array.from({ length: 50 }, (_, i) => ({
            aspectId,
            name: `chunk-${i}.txt`,
            text: `Page ${i} text content`
        }));

        await expect(saveKnowledgeFileBatch(entries)).resolves.not.toThrow();

        resetCacheForTesting();
        const files = await getKnowledgeFilesRaw(aspectId);
        expect(files.length).toBe(50);
    });

    it('uses one read-write transaction for 50 chunks', async () => {
        await getKnowledgeFilesRaw('transaction-count');
        const db = await getDB();
        const spy = vi.spyOn(db, 'transaction');
        await saveKnowledgeFileBatch(Array.from({ length: 50 }, (_, i) => ({ aspectId: 'transaction-count', name: `chunk${i}`, text: 'page' })));
        expect(spy.mock.calls.filter(call => call[1] === 'readwrite')).toHaveLength(1);
        spy.mockRestore();
    });

    it('is a no-op for an empty array', async () => {
        await expect(saveKnowledgeFileBatch([])).resolves.toBeUndefined();
    });

    it('is a no-op for null/undefined', async () => {
        await expect(saveKnowledgeFileBatch(null)).resolves.toBeUndefined();
        await expect(saveKnowledgeFileBatch(undefined)).resolves.toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('deleteAspectData cleans up batched chunks', () => {
    beforeEach(() => {
        resetCacheForTesting();
    });

    it('removes all compound-key entries written via saveKnowledgeFileBatch', async () => {
        const aspectId = 'delete-batch-aspect';
        const entries = Array.from({ length: 10 }, (_, i) => ({
            aspectId,
            name: `page-${i}.txt`,
            text: `page ${i}`
        }));

        await saveKnowledgeFileBatch(entries);
        resetCacheForTesting();

        let files = await getKnowledgeFilesRaw(aspectId);
        expect(files.length).toBe(10);

        await deleteAspectData(aspectId);
        resetCacheForTesting();

        files = await getKnowledgeFilesRaw(aspectId);
        expect(files.length).toBe(0);
    });

    it('does not disturb other aspects\' batched chunks', async () => {
        const idA = 'delete-aspect-a';
        const idB = 'delete-aspect-b';

        await saveKnowledgeFileBatch([{ aspectId: idA, name: 'a.txt', text: 'aaa' }]);
        await saveKnowledgeFileBatch([{ aspectId: idB, name: 'b.txt', text: 'bbb' }]);

        await deleteAspectData(idA);
        resetCacheForTesting();

        const filesA = await getKnowledgeFilesRaw(idA);
        const filesB = await getKnowledgeFilesRaw(idB);

        expect(filesA.length).toBe(0);
        expect(filesB.length).toBe(1);
        expect(filesB[0].text).toBe('bbb');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('saveKnowledgeFileBatch atomic failure handling', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        resetCacheForTesting();
    });

    it('rejects and leaves no partial state when the IDB transaction errors', async () => {
        resetCacheForTesting();

        // Intercept IDBObjectStore.put to throw on the second call only.
        let putCallCount = 0;
        const originalPut = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) {
            putCallCount++;
            if (putCallCount === 2) {
                // Restore immediately so later tests are not affected.
                IDBObjectStore.prototype.put = originalPut;
                throw new DOMException('QuotaExceededError', 'QuotaExceededError');
            }
            return originalPut.apply(this, args);
        };

        const aspectId = 'atomic-fail-aspect';
        const entries = [
            { aspectId, name: 'ok.txt', text: 'fine' },
            { aspectId, name: 'fail.txt', text: 'boom' }
        ];

        await expect(saveKnowledgeFileBatch(entries)).rejects.toBeDefined();

        // Since put threw synchronously the transaction was never committed;
        // the cache must not have been updated.
        const files = await getKnowledgeFilesRaw(aspectId);
        expect(files.length).toBe(0);
        // Read the actual store: an unchanged cache can hide a partial commit.
        const db = await getDB();
        const persisted = await requestToPromise(db.transaction('files').objectStore('files').getAll());
        expect(persisted.filter(file => file.aspectId === aspectId)).toEqual([]);
        resetCacheForTesting();
        expect(await getKnowledgeFilesRaw(aspectId)).toEqual([]);
    });
});
