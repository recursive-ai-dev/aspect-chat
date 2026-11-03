import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { state } from '../src/js/modules/state.js';
import { importAllAspects } from '../src/js/modules/backup.js';
import { normalizeAspect } from '../src/js/modules/aspects.js';
import { renderChatMessages } from '../src/js/modules/chat.js';
import { loadAspects, parseLibrary, resetPersistForTesting, getSnapshot } from '../src/js/modules/persist.js';
import { resetDatabaseForTesting, withStore } from '../src/js/modules/idb.js';

const maliciousMessage = () => ({
    role: 'assistant', content: 'safe plaintext',
    _renderedContent: 'safe plaintext',
    _renderedHtml: '<img src="x" onerror="window.compromised=true"><a data-action="storage-fresh">delete</a>',
    _isEditing: false
});

beforeEach(async () => {
    resetPersistForTesting();
    indexedDB.deleteDatabase('AspectKnowledgeDB');
    await resetDatabaseForTesting();
    localStorage.clear();
    state.isGenerating = false;
    state.libraryBusy = false;
    state.aspects = [normalizeAspect({ id: 'existing', name: 'Existing' })];
    state.currentAspectId = 'existing';
    window.showToast = vi.fn();
    document.body.innerHTML = '<div id="aspect-list"></div><div id="chat-messages"></div>';
});
afterEach(() => { resetPersistForTesting(); vi.restoreAllMocks(); });

function assertSafe(aspect) {
    const message = aspect.chatHistory[0];
    expect(message).not.toHaveProperty('_renderedHtml');
    expect(message).not.toHaveProperty('_renderedContent');
    expect(message).not.toHaveProperty('_isEditing');
    state.aspects = [normalizeAspect(aspect)];
    state.currentAspectId = aspect.id;
    renderChatMessages();
    const chat = document.getElementById('chat-messages');
    expect(chat.textContent).toContain('safe plaintext');
    expect(chat.querySelector('[onerror], [data-action], textarea, img')).toBeNull();
}

describe('untrusted render-cache rejection', () => {
    it('imports and renders a real library without trusting forged matching HTML caches', async () => {
        const text = JSON.stringify({ format: 'aspect-studio-library', version: 1, aspects: [{
            id: 'incoming', name: 'Untrusted', conversations: [{ id: 'chat', messages: [maliciousMessage()] }]
        }] });
        await importAllAspects({ size: text.length, text: async () => text });
        expect(state.aspects).toHaveLength(2);
        assertSafe(state.aspects[1]);
    });

    it('also strips legacy chatHistory caches at the JSON import boundary', () => {
        const [aspect] = parseLibrary(JSON.stringify([{ id: 'legacy', chatHistory: [maliciousMessage()] }]));
        assertSafe(aspect);
    });

    it('strips caches from authoritative database hydration and snapshots', async () => {
        await withStore('aspects', 'readwrite', store => store.put({ id: 'disk', chatHistory: [maliciousMessage()] }));
        const [disk] = await loadAspects();
        assertSafe(disk);
        await withStore('snapshots', 'readwrite', store => store.put({ id: 'forged-snapshot', aspects: [{ id: 'snapshot', chatHistory: [maliciousMessage()] }] }));
        const snapshot = await getSnapshot('forged-snapshot');
        assertSafe(snapshot.aspects[0]);
    });
});

describe('malformed imported presentation fields', () => {
    it('normalizes icon/background and object maps before committing and presenting the library', async () => {
        const text = JSON.stringify([{ name: 'Malformed presentation', background: 123, icon: {}, memory: [], params: [] }]);
        await importAllAspects({ size: text.length, text: async () => text });
        expect(state.aspects).toHaveLength(2);
        const imported = state.aspects[1];
        expect(imported).toMatchObject({ icon: '', background: '', memory: {}, params: {} });
        const disk = await loadAspects();
        expect(disk.some(aspect => aspect.id === imported.id)).toBe(true);
        expect(window.showToast).toHaveBeenCalledWith('Imported 1 Aspect(s).');
    });
});
