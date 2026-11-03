import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    exportAllAspects,
    importAllAspects,
    restoreSnapshot,
    getSnapshots,
    snapshotNow,
    MAX_BACKUP_FILE_SIZE
} from '../src/js/modules/backup.js';
import { state } from '../src/js/modules/state.js';
import { flushAspects } from '../src/js/modules/state.js';
import * as persist from '../src/js/modules/persist.js';
import * as ui from '../src/js/modules/ui.js';
import * as aspects from '../src/js/modules/aspects.js';

vi.mock('../src/js/modules/persist.js', () => ({
    serializeLibrary: vi.fn((aspects) => JSON.stringify({ aspects })),
    parseLibrary: vi.fn((text) => {
        const data = JSON.parse(text);
        if (!data || !Array.isArray(data.aspects) || data.aspects.length === 0) {
            throw new Error('No Aspects found in that file.');
        }
        return data.aspects;
    }),
    sanitizeImportedAspect: vi.fn((a) => a),
    listSnapshots: vi.fn(),
    getSnapshot: vi.fn(),
    writeSnapshot: vi.fn(),
    armPersistence: vi.fn(),
    disarmPersistence: vi.fn(),
    isPersistReady: vi.fn(() => true)
}));

vi.mock('../src/js/modules/ui.js', () => ({
    applyAspectBackground: vi.fn(),
    showChatView: vi.fn(),
    showToast: vi.fn()
}));

vi.mock('../src/js/modules/aspects.js', () => ({
    normalizeAspect: vi.fn((a) => ({ ...a, normalized: true })),
    renderAspectList: vi.fn()
}));

vi.mock('../src/js/modules/state.js', () => ({
    state: {
        aspects: [],
        currentAspectId: null
    },
    persistAspects: vi.fn(),
    flushAspects: vi.fn().mockResolvedValue(undefined)
}));

describe('backup.js - Whole library backup and recovery', () => {
    let mockAnchor;

    beforeEach(() => {
        window.showToast = vi.fn();
        mockAnchor = {
            href: '',
            download: '',
            click: vi.fn()
        };
        global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
        global.URL.revokeObjectURL = vi.fn();
        vi.spyOn(document, 'createElement').mockImplementation((tag) => {
            if (tag === 'a') return mockAnchor;
            return document.createElement(tag);
        });
        state.aspects = [];
        state.currentAspectId = null;
        state.libraryBusy = false;
        state.isGenerating = false;
        persist.writeSnapshot.mockResolvedValue('pre-restore-snapshot');
        persist.isPersistReady.mockReturnValue(true);
        localStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('exportAllAspects', () => {
        it('should show error toast if state.aspects is empty', () => {
            state.aspects = [];
            exportAllAspects();
            expect(window.showToast).toHaveBeenCalledWith('No Aspects to export.', 'error');
            expect(mockAnchor.click).not.toHaveBeenCalled();
        });

        it('should download serialized library when aspects exist', async () => {
            state.aspects = [{ id: 'a1', name: 'Aspect 1' }];
            await exportAllAspects();
            expect(persist.serializeLibrary).toHaveBeenCalledWith(state.aspects);
            expect(mockAnchor.download).toMatch(/^aspect-studio-library-.*\.aspects\.json$/);
            expect(mockAnchor.click).toHaveBeenCalled();
            expect(window.showToast).toHaveBeenCalledWith('Exported 1 Aspect(s).');
        });
    });

    describe('importAllAspects', () => {
        it('rolls back state and selection when the durable save fails', async () => {
            state.aspects = [{ id: 'old', name: 'Keep' }];
            state.currentAspectId = 'old';
            flushAspects.mockRejectedValueOnce(new Error('quota exceeded'));
            await importAllAspects({ size: 100, text: async () => '{"aspects":[{"name":"Incoming"}]}' });
            expect(state.aspects).toEqual([{ id: 'old', name: 'Keep' }]);
            expect(state.currentAspectId).toBe('old');
            expect(state.libraryBusy).toBe(false);
            expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('quota exceeded'), 'error');
            expect(window.showToast).not.toHaveBeenCalledWith('Imported 1 Aspect(s).');
        });

        it('refuses imports during recovery or generation', async () => {
            persist.isPersistReady.mockReturnValueOnce(false);
            const file = { size: 10, text: vi.fn() };
            await importAllAspects(file);
            expect(file.text).not.toHaveBeenCalled();
            state.isGenerating = true;
            await importAllAspects(file);
            expect(file.text).not.toHaveBeenCalled();
            expect(state.aspects).toEqual([]);
        });
        it('should safely do nothing if file is null', async () => {
            await importAllAspects(null);
            expect(window.showToast).not.toHaveBeenCalled();
        });

        it('should reject files exceeding MAX_BACKUP_FILE_SIZE (20MB)', async () => {
            const oversizedFile = {
                size: MAX_BACKUP_FILE_SIZE + 1024,
                text: vi.fn()
            };
            await importAllAspects(oversizedFile);
            expect(window.showToast).toHaveBeenCalledWith(
                'File exceeds the maximum size limit of 20MB.',
                'error'
            );
            expect(oversizedFile.text).not.toHaveBeenCalled();
        });

        it('should show error toast if file content fails to parse', async () => {
            const invalidFile = {
                size: 100,
                text: vi.fn().mockResolvedValue('invalid json')
            };
            await importAllAspects(invalidFile);
            expect(window.showToast).toHaveBeenCalledWith(
                expect.stringContaining('Could not import that file:'),
                'error'
            );
        });

        it('should show error toast if parsed aspects list is empty', async () => {
            persist.parseLibrary.mockReturnValueOnce([]);
            const emptyFile = {
                size: 100,
                text: vi.fn().mockResolvedValue('{"aspects": []}')
            };
            await importAllAspects(emptyFile);
            expect(window.showToast).toHaveBeenCalledWith('No Aspects found in that file.', 'error');
        });

        it('should successfully import aspects, re-key them, update state and apply background', async () => {
            const incomingAspects = [{ id: 'incoming-1', name: 'Incoming Aspect' }];
            persist.parseLibrary.mockReturnValueOnce(incomingAspects);

            const validFile = {
                size: 200,
                text: vi.fn().mockResolvedValue(JSON.stringify({ aspects: incomingAspects }))
            };

            await importAllAspects(validFile);

            expect(state.aspects.length).toBe(1);
            expect(state.aspects[0].name).toBe('Incoming Aspect');
            expect(state.aspects[0].id).not.toBe('incoming-1'); // Re-keyed with newId
            expect(state.currentAspectId).toBe(state.aspects[0].id);
            expect(localStorage.getItem('currentAspectId')).toBe(state.aspects[0].id);
            expect(ui.applyAspectBackground).toHaveBeenCalled();
            expect(aspects.renderAspectList).toHaveBeenCalled();
            expect(window.showToast).toHaveBeenCalledWith('Imported 1 Aspect(s).');
        });
    });

    describe('restoreSnapshot', () => {
        it('keeps the old library if a pre-restore snapshot cannot be written', async () => {
            const old = [{ id: 'old', name: 'Keep' }];
            state.aspects = old;
            state.currentAspectId = 'old';
            persist.getSnapshot.mockResolvedValueOnce({ aspects: [{ id: 'new' }] });
            persist.writeSnapshot.mockResolvedValueOnce(null);
            expect(await restoreSnapshot('snap')).toBe(false);
            expect(state.aspects).toBe(old);
            expect(state.currentAspectId).toBe('old');
            expect(state.libraryBusy).toBe(false);
        });

        it('rolls back a rejected restore save and retains recovery write protection', async () => {
            const old = [{ id: 'old', name: 'Keep' }];
            state.aspects = old;
            state.currentAspectId = 'old';
            persist.isPersistReady.mockReturnValueOnce(false);
            persist.getSnapshot.mockResolvedValueOnce({ aspects: [{ id: 'new' }], createdAt: 1 });
            flushAspects.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('transaction aborted'));
            expect(await restoreSnapshot('snap')).toBe(false);
            expect(state.aspects).toBe(old);
            expect(state.currentAspectId).toBe('old');
            expect(persist.disarmPersistence).toHaveBeenCalled();
            expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('transaction aborted'), 'error');
        });

        it('holds the library lock until restore persistence has completed', async () => {
            let finish;
            const commit = new Promise(resolve => { finish = resolve; });
            persist.getSnapshot.mockResolvedValueOnce({ aspects: [{ id: 'new' }], createdAt: 1 });
            flushAspects.mockResolvedValueOnce(undefined).mockReturnValueOnce(commit);
            const restore = restoreSnapshot('snap');
            await vi.waitFor(() => expect(state.currentAspectId).toBe('new'));
            expect(state.libraryBusy).toBe(true);
            expect(window.showToast).not.toHaveBeenCalledWith(expect.stringContaining('Restored'));
            finish();
            expect(await restore).toBe(true);
            expect(state.libraryBusy).toBe(false);
        });
        it('should show error toast if snapshot cannot be found or has no aspects', async () => {
            persist.getSnapshot.mockResolvedValueOnce(null);
            const result = await restoreSnapshot('nonexistent');
            expect(result).toBe(false);
            expect(window.showToast).toHaveBeenCalledWith('That snapshot could not be read.', 'error');
        });

        it('should write pre-restore snapshot, arm persistence, restore aspects and apply background', async () => {
            const initialAspects = [{ id: 'old-1', name: 'Old Aspect' }];
            state.aspects = initialAspects;
            const snapshotData = {
                id: 'snap-1',
                createdAt: 1700000000000,
                aspects: [{ id: 'restored-1', name: 'Restored Aspect' }]
            };
            persist.getSnapshot.mockResolvedValueOnce(snapshotData);

            const result = await restoreSnapshot('snap-1');

            expect(result).toBe(true);
            expect(persist.writeSnapshot).toHaveBeenCalledWith(initialAspects, 'pre-restore');
            expect(persist.armPersistence).toHaveBeenCalled();
            expect(state.aspects.length).toBe(1);
            expect(state.currentAspectId).toBe('restored-1');
            expect(localStorage.getItem('currentAspectId')).toBe('restored-1');
            expect(ui.applyAspectBackground).toHaveBeenCalled();
            expect(aspects.renderAspectList).toHaveBeenCalled();
            expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('Restored 1 Aspect(s)'));
        });
    });

    describe('getSnapshots and snapshotNow', () => {
        it('should delegate to listSnapshots and writeSnapshot', async () => {
            persist.listSnapshots.mockReturnValueOnce([{ id: 'snap-1' }]);
            expect(getSnapshots()).toEqual([{ id: 'snap-1' }]);

            await snapshotNow('test-label');
            expect(persist.writeSnapshot).toHaveBeenCalledWith(state.aspects, 'test-label');
        });
    });
});
