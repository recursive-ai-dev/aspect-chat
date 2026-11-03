import { describe, it, expect, beforeEach } from 'vitest';
import { getDB, resetDatabaseForTesting, withStore, requestToPromise } from '../src/js/modules/idb.js';
import { commitImportedAspect, getKnowledgeFilesRaw, resetCacheForTesting, saveMemory, getMemory } from '../src/js/modules/db.js';
import { durableMemory } from '../src/js/modules/memory.js';

beforeEach(async () => {
    indexedDB.deleteDatabase('AspectKnowledgeDB');
    await resetDatabaseForTesting();
    resetCacheForTesting();
});

describe('durable memory projection', () => {
    it('retains runtime ephemeral keys while a later durable write omits them from disk', async () => {
        const memory = { '~secret': 'session-only', permanent: 42 };
        await saveMemory('aspect', memory);
        const raw = await withStore('memory', 'readonly', s => requestToPromise(s.get('aspect')));
        expect(raw.memory).toEqual({ permanent: 42 });
        expect(await getMemory('aspect')).toEqual({ permanent: 42 });
        expect(memory['~secret']).toBe('session-only');
    });

    it('reopens a closed connection for direct memory and knowledge consumers', async () => {
        (await getDB()).close();
        await saveMemory('reopened', { saved: true });
        (await getDB()).close();
        expect(await getMemory('reopened')).toEqual({ saved: true });
        (await getDB()).close();
        await commitImportedAspect({ id: 'after-close' }, [{ name: 'a.md', text: 'retained' }]);
        expect(await getKnowledgeFilesRaw('after-close')).toHaveLength(1);
    });

    it('handles invalid maps and preserves safe own keys without prototype mutation', () => {
        for (const value of [null, undefined, [], 3, 'text']) expect(durableMemory(value)).toEqual({});
        const input = JSON.parse('{"__proto__":{"polluted":true},"~private":1,"safe":2}');
        const output = durableMemory(input);
        expect(Object.getPrototypeOf(output)).toBe(Object.prototype);
        expect(Object.hasOwn(output, '__proto__')).toBe(true);
        expect({}.polluted).toBeUndefined();
        expect(output.safe).toBe(2);
        expect(output['~private']).toBeUndefined();
    });
});

describe('atomic imported Aspect transaction', () => {
    it('commits the Aspect and all files together and updates the cache afterwards', async () => {
        await commitImportedAspect({ id: 'new', name: 'Imported' }, [{ name: 'a.md', text: 'A' }, { name: 'b.md', text: 'B' }]);
        const record = await withStore('aspects', 'readonly', s => requestToPromise(s.get('new')));
        expect(record.name).toBe('Imported');
        expect(await getKnowledgeFilesRaw('new')).toEqual([
            { aspectId: 'new', name: 'a.md', text: 'A' }, { aspectId: 'new', name: 'b.md', text: 'B' }
        ]);
    });

    it('rolls back queued files on an asynchronous Aspect insert failure', async () => {
        await commitImportedAspect({ id: 'existing', name: 'Keep' }, []);
        await expect(commitImportedAspect({ id: 'existing', name: 'Replace' }, [{ name: 'orphan.md', text: 'must roll back' }])).rejects.toBeTruthy();
        const record = await withStore('aspects', 'readonly', s => requestToPromise(s.get('existing')));
        expect(record.name).toBe('Keep');
        expect(await withStore('files', 'readonly', s => requestToPromise(s.getAll()))).toEqual([]);
        expect(await getKnowledgeFilesRaw('existing')).toEqual([]);
    });

    it('rejects invalid or duplicate knowledge filenames without partial insertion', async () => {
        await expect(commitImportedAspect({ id: 'invalid' }, [{ name: 'same', text: '1' }, { name: 'same', text: '2' }])).rejects.toThrow('duplicate');
        expect(await withStore('aspects', 'readonly', s => requestToPromise(s.get('invalid')))).toBeUndefined();
    });
});
