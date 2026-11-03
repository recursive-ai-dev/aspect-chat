/**
 * Whole-library backup & recovery.
 *
 * Two independent safety nets, both distinct from a single .aspect export:
 *
 *  - Manual: "Export all" writes every Aspect to one JSON file; "Import all"
 *    merges such a file back in.
 *  - Automatic: rolling timestamped snapshots of the entire library (see
 *    persist.js) that can be restored from Settings if an import, a mis-click,
 *    or a corrupted write loses work.
 */

import { state } from './state.js';
import {
    serializeLibrary,
    parseLibrary,
    sanitizeImportedAspect,
    listSnapshots,
    getSnapshot,
    writeSnapshot,
    armPersistence,
    disarmPersistence,
    isPersistReady
} from './persist.js';
import { normalizeAspect, renderAspectList } from './aspects.js';
import { applyAspectBackground } from './ui.js';
import { persistAspects, flushAspects } from './state.js';
import { newId } from './conversations.js';
import { saveBlob } from './download.js';

export const MAX_BACKUP_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

function stamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function restoreSelection(aspects, id) {
    state.aspects = aspects;
    state.currentAspectId = id;
    try {
        if (id) localStorage.setItem('currentAspectId', id);
        else localStorage.removeItem('currentAspectId');
    } catch { /* the in-memory selection still works */ }
}

/** Export every Aspect to a single JSON file. */
export async function exportAllAspects() {
    if (!state.aspects || state.aspects.length === 0) {
        window.showToast('No Aspects to export.', 'error');
        return;
    }
    try {
        const count = state.aspects.length;
        const blob = new Blob([serializeLibrary(state.aspects)], { type: 'application/json' });
        if (await saveBlob(blob, `aspect-studio-library-${stamp()}.aspects.json`)) {
            window.showToast(`Exported ${count} Aspect(s).`);
        }
    } catch (err) {
        window.showToast(`Export failed: ${err.message}`, 'error');
    }
}

/** Merge a previously exported library file into the current one. */
export async function importAllAspects(file) {
    if (!file) return;
    if (state.isGenerating || state.libraryBusy) {
        window.showToast('Finish the current operation before importing a library.', 'warning');
        return;
    }
    if (Number.isFinite(file.size) && file.size > MAX_BACKUP_FILE_SIZE) {
        window.showToast('File exceeds the maximum size limit of 20MB.', 'error');
        return;
    }
    state.libraryBusy = true;
    const previous = state.aspects.slice();
    const previousId = state.currentAspectId;
    let committed = false;
    try {
        if (!isPersistReady()) throw new Error('Storage recovery is read-only. Export a backup and reload to retry.');
        await flushAspects();
        const incoming = parseLibrary(await file.text());
        if (!Array.isArray(incoming) || incoming.length === 0) {
            window.showToast('No Aspects found in that file.', 'error');
            return;
        }
        const added = incoming.map(a => normalizeAspect(sanitizeImportedAspect({ ...a, id: newId('aspect') })));
        state.aspects.push(...added);
        if (!state.currentAspectId || !state.aspects.some(a => a.id === state.currentAspectId)) {
            restoreSelection(state.aspects, added[0].id);
        }
        persistAspects();
        await flushAspects();
        committed = true;
        applyAspectBackground();
        renderAspectList();
        window.showToast(`Imported ${added.length} Aspect(s).`);
    } catch (err) {
        if (committed) {
            window.showToast(`Library saved, but the view could not refresh: ${err.message}. Reload the app.`, 'error');
        } else {
            restoreSelection(previous, previousId);
            window.showToast(`Could not import that file: ${err.message}`, 'error');
        }
    } finally {
        state.libraryBusy = false;
    }
}

/** [{ id, createdAt, label, aspectCount }] newest first. */
export function getSnapshots() {
    return listSnapshots();
}

/** Snapshot the library right now (used before a risky operation). */
export function snapshotNow(label = 'manual') {
    return writeSnapshot(state.aspects, label);
}

/**
 * Replace the current library with a snapshot's contents.
 * Takes a snapshot of the current state first, so a restore is itself undoable.
 */
export async function restoreSnapshot(id) {
    if (state.isGenerating || state.libraryBusy) {
        window.showToast('Finish the current operation before restoring a snapshot.', 'warning');
        return false;
    }
    state.libraryBusy = true;
    const previous = state.aspects;
    const previousId = state.currentAspectId;
    const wasReady = isPersistReady();
    let committed = false;
    try {
        await flushAspects();
        const snap = await getSnapshot(id);
        if (!snap || !Array.isArray(snap.aspects) || snap.aspects.length === 0) {
            window.showToast('That snapshot could not be read.', 'error');
            return false;
        }
        const backupId = await writeSnapshot(state.aspects, 'pre-restore');
        if (state.aspects.length && !backupId) {
            throw new Error('The current library could not be backed up; restore was cancelled.');
        }
        const restored = snap.aspects.map(a => normalizeAspect(a));
        armPersistence(); // a deliberate restore re-enables writes after a failure
        restoreSelection(restored, restored[0].id);
        persistAspects();
        await flushAspects();
        committed = true;
        applyAspectBackground();
        renderAspectList();
        if (typeof window.showChatView === 'function') window.showChatView();
        window.showToast(`Restored ${state.aspects.length} Aspect(s) from ${new Date(snap.createdAt).toLocaleString()}.`);
        return true;
    } catch (err) {
        if (committed) {
            window.showToast(`Snapshot saved, but the view could not refresh: ${err.message}. Reload the app.`, 'error');
            return true;
        }
        restoreSelection(previous, previousId);
        if (!wasReady) disarmPersistence(err);
        window.showToast(`Could not restore that snapshot: ${err.message}`, 'error');
        return false;
    } finally {
        state.libraryBusy = false;
    }
}
