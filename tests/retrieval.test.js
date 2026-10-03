import { describe, it, expect, vi, beforeEach } from 'vitest';
import { retrieveKnowledge, chunkText, cosineSimilarity, rankLexically } from '../src/js/modules/retrieval.js';
import { saveKnowledgeFileBatch, deleteKnowledgeFile, deleteAspectData, resetCacheForTesting } from '../src/js/modules/db.js';
import { getDB, requestToPromise } from '../src/js/modules/idb.js';
vi.mock('../src/js/modules/aspects.js', () => ({ getCurrentAspect: vi.fn() }));
beforeEach(() => resetCacheForTesting());
describe('semantic knowledge retrieval', () => {
    it('chunks with overlap without losing trailing text', () => {
        expect(chunkText('abcdefghijk', 5, 2)).toEqual(['abcde', 'defgh', 'ghijk']);
        expect(() => chunkText('hi', 5, 5)).toThrow();
        expect(chunkText('')).toEqual([]);
    });
    it('ranks normalized and unnormalized vectors by cosine similarity', () => {
        expect(cosineSimilarity([2, 0], [1, 0])).toBe(1);
        expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
        expect(rankLexically([{ text: 'boats in the sea' }, { text: 'cats sleep' }], 'sea boats')[0].text).toContain('boats');
    });
    it('retrieves top K, reuses persisted vectors, replaces edits and deletes file vectors', async () => {
        const aspect = { id: 'semantic-test', knowledge: '' };
        await saveKnowledgeFileBatch([
            { aspectId: aspect.id, name: 'cats.txt', text: 'cats sleep' },
            { aspectId: aspect.id, name: 'sea.txt', text: 'boats sail' }
        ]);
        const embed = vi.fn(async texts => texts.map(text => text.includes('cat') ? [1, 0] : [0, 1]));
        const settings = { retrievalTopK: 1 };
        const result = await retrieveKnowledge(aspect, 'cat', settings, embed);
        expect(result).toContain('cats sleep');
        expect(result).not.toContain('boats sail');
        embed.mockClear();
        await retrieveKnowledge(aspect, 'cat', settings, embed);
        expect(embed).toHaveBeenCalledTimes(1); // query only
        await saveKnowledgeFileBatch([{ aspectId: aspect.id, name: 'cats.txt', text: 'boats float' }]);
        embed.mockClear();
        await retrieveKnowledge(aspect, 'boat', settings, embed);
        expect(embed.mock.calls[0][0]).toEqual(['boats float']);
        await deleteKnowledgeFile(aspect.id, 'cats.txt');
        const db = await getDB();
        const rows = await requestToPromise(db.transaction('vectors').objectStore('vectors').index('aspectId').getAll(aspect.id));
        expect(rows.map(row => row.name)).toEqual(['sea.txt']);
        await deleteAspectData(aspect.id);
        expect(await requestToPromise(db.transaction('vectors').objectStore('vectors').index('aspectId').getAll(aspect.id))).toEqual([]);
    });
    it('uses bounded keyword retrieval when the model is offline', async () => {
        const embed = vi.fn().mockRejectedValue(new Error('offline'));
        const result = await retrieveKnowledge({ id: 'offline-test', knowledge: 'boats sail' }, 'boats', { retrievalTopK: 1 }, embed);
        expect(result).toContain('boats sail');
    });
});
