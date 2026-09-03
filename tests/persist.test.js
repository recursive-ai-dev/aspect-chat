import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetDatabaseForTesting, STORE_ASPECTS, withStore, requestToPromise } from '../src/js/modules/idb.js';
import {
    serializeAspect,
    saveAspects,
    loadAspects,
    scheduleSave,
    flushSave,
    deleteAspectRecord,
    migrateFromLocalStorage,
    resetPersistForTesting
} from '../src/js/modules/persist.js';
import { normalizeConversations } from '../src/js/modules/conversations.js';

async function freshDatabase() {
    resetPersistForTesting();
    indexedDB.deleteDatabase('AspectKnowledgeDB');
    await resetDatabaseForTesting();
}

function makeAspect(overrides = {}) {
    return normalizeConversations({
        id: 'a1',
        name: 'Test Aspect',
        instructions: 'Be useful',
        knowledge: '',
        tools: [],
        memory: {},
        chatHistory: [{ role: 'user', content: 'Hello' }],
        ...overrides
    });
}

describe('serializeAspect', () => {
    it('drops the chatHistory alias so messages are not stored twice', () => {
        const aspect = makeAspect();
        const record = serializeAspect(aspect);

        expect(record.chatHistory).toBeUndefined();
        expect(record.conversations[0].messages).toEqual([{ role: 'user', content: 'Hello' }]);
    });

    it('strips render caches and transient edit state from messages', () => {
        const aspect = makeAspect();
        Object.assign(aspect.chatHistory[0], {
            _renderedHtml: '<p>Hello</p>',
            _renderedContent: 'Hello',
            _isEditing: true
        });

        const message = serializeAspect(aspect).conversations[0].messages[0];
        expect(message).toEqual({ role: 'user', content: 'Hello' });
    });

    it('keeps every persistent Aspect field', () => {
        const aspect = makeAspect({ icon: 'data:image/png;base64,AAA', params: { temperature: 0.2 } });
        const record = serializeAspect(aspect);

        expect(record.name).toBe('Test Aspect');
        expect(record.icon).toBe('data:image/png;base64,AAA');
        expect(record.params).toEqual({ temperature: 0.2 });
    });
});

describe('saveAspects / loadAspects', () => {
    beforeEach(freshDatabase);

    it('round-trips an Aspect library through IndexedDB', async () => {
        await saveAspects([makeAspect(), makeAspect({ id: 'a2', name: 'Second' })]);

        const loaded = await loadAspects();
        expect(loaded).toHaveLength(2);
        expect(loaded.map(a => a.name).sort()).toEqual(['Second', 'Test Aspect']);
    });

    it('rebinds chatHistory to the active conversation on load', async () => {
        await saveAspects([makeAspect()]);

        const [loaded] = await loadAspects();
        expect(loaded.chatHistory).toEqual([{ role: 'user', content: 'Hello' }]);
        expect(loaded.chatHistory).toBe(loaded.conversations[0].messages);
    });

    it('removes rows for Aspects deleted since the last write', async () => {
        await saveAspects([makeAspect(), makeAspect({ id: 'a2', name: 'Second' })]);
        await saveAspects([makeAspect()]);

        const loaded = await loadAspects();
        expect(loaded.map(a => a.id)).toEqual(['a1']);
    });

    it('returns an empty array when nothing has been saved', async () => {
        await expect(loadAspects()).resolves.toEqual([]);
    });

    it('handles a library far larger than the old localStorage quota', async () => {
        // ~8MB of chat history — the exact case that silently threw and lost
        // everything under the previous localStorage implementation.
        const bulky = makeAspect({
            chatHistory: Array.from({ length: 400 }, (_, i) => ({
                role: i % 2 ? 'assistant' : 'user',
                content: 'x'.repeat(20000)
            }))
        });
        normalizeConversations(bulky);

        await expect(saveAspects([bulky])).resolves.toBeUndefined();
        const [loaded] = await loadAspects();
        expect(loaded.chatHistory).toHaveLength(400);
    });

    it('deletes a single record', async () => {
        await saveAspects([makeAspect(), makeAspect({ id: 'a2', name: 'Second' })]);
        await deleteAspectRecord('a2');

        const rows = await withStore(STORE_ASPECTS, 'readonly', store => requestToPromise(store.getAll()));
        expect(rows.map(r => r.id)).toEqual(['a1']);
    });
});

describe('scheduleSave / flushSave', () => {
    beforeEach(freshDatabase);

    it('collapses rapid calls into a single write', async () => {
        vi.useFakeTimers();
        try {
            const aspects = [makeAspect()];
            scheduleSave(aspects);
            scheduleSave(aspects);
            const last = scheduleSave(aspects);

            await vi.advanceTimersByTimeAsync(500);
            await last;
        } finally {
            vi.useRealTimers();
        }

        const rows = await withStore(STORE_ASPECTS, 'readonly', store => requestToPromise(store.getAll()));
        expect(rows).toHaveLength(1);
    });

    it('flushSave writes immediately without waiting out the debounce', async () => {
        scheduleSave([makeAspect()]);
        await flushSave();

        const rows = await withStore(STORE_ASPECTS, 'readonly', store => requestToPromise(store.getAll()));
        expect(rows).toHaveLength(1);
    });

    it('flushSave is a no-op when nothing is queued', async () => {
        await expect(flushSave()).resolves.toBeUndefined();
    });
});

describe('migrateFromLocalStorage', () => {
    beforeEach(async () => {
        await freshDatabase();
        localStorage.clear();
    });

    it('moves a legacy library into IndexedDB and keeps a backup', async () => {
        const legacy = [{ id: 'old1', name: 'Legacy', chatHistory: [{ role: 'user', content: 'Old message' }] }];
        localStorage.setItem('aspects_data', JSON.stringify(legacy));

        const migrated = await migrateFromLocalStorage();

        expect(migrated).toHaveLength(1);
        expect(migrated[0].conversations[0].messages[0].content).toBe('Old message');

        // The original blob is preserved, not thrown away.
        expect(localStorage.getItem('aspects_data_v1_backup')).toBe(JSON.stringify(legacy));
        expect(localStorage.getItem('aspects_data')).toBeNull();
        expect(localStorage.getItem('aspects_migrated_to_idb')).toBe('true');

        const rows = await withStore(STORE_ASPECTS, 'readonly', store => requestToPromise(store.getAll()));
        expect(rows).toHaveLength(1);
    });

    it('runs only once', async () => {
        localStorage.setItem('aspects_data', JSON.stringify([{ id: 'x', name: 'X' }]));
        await migrateFromLocalStorage();
        await expect(migrateFromLocalStorage()).resolves.toBeNull();
    });

    it('leaves an unparseable blob alone rather than destroying it', async () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        localStorage.setItem('aspects_data', 'not json{');

        await expect(migrateFromLocalStorage()).resolves.toBeNull();
        expect(localStorage.getItem('aspects_data')).toBe('not json{');

        spy.mockRestore();
    });

    it('does nothing when there is no legacy data', async () => {
        await expect(migrateFromLocalStorage()).resolves.toBeNull();
    });

    it('loadAspects performs the migration transparently', async () => {
        localStorage.setItem('aspects_data', JSON.stringify([
            { id: 'old1', name: 'Legacy', chatHistory: [{ role: 'user', content: 'Carried over' }] }
        ]));

        const loaded = await loadAspects();
        expect(loaded).toHaveLength(1);
        expect(loaded[0].chatHistory[0].content).toBe('Carried over');
    });
});
