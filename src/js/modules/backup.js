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
    armPersistence
} from './persist.js';
import { normalizeAspect, renderAspectList } from './aspects.js';
import { applyAspectBackground } from './ui.js';
import { persistAspects } from './state.js';
import { newId } from './conversations.js';

export const MAX_BACKUP_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

function download(filename, text, mime = 'application/json') {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function stamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/** Export every Aspect to a single JSON file. */
export function exportAllAspects() {
    if (!state.aspects || state.aspects.length === 0) {
        window.showToast('No Aspects to export.', 'error');
        return;
    }
    download(`aspect-studio-library-${stamp()}.aspects.json`, serializeLibrary(state.aspects));
    window.showToast(`Exported ${state.aspects.length} Aspect(s).`);
}

/** Merge a previously exported library file into the current one. */
export async function importAllAspects(file) {
    if (!file) return;
    if (Number.isFinite(file.size) && file.size > MAX_BACKUP_FILE_SIZE) {
        window.showToast('File exceeds the maximum size limit of 20MB.', 'error');
        return;
    }
    let incoming;
    try {
        incoming = parseLibrary(await file.text());
    } catch (err) {
        window.showToast(`Could not read that file: ${err.message}`, 'error');
        return;
    }

    if (!Array.isArray(incoming) || incoming.length === 0) {
        window.showToast('No Aspects found in that file.', 'error');
        return;
    }

    // Re-key every incoming Aspect so a re-import never collides with a copy
    // that is already here. sanitizeImportedAspect strips trust hashes and
    // network permissions asserted by the file before normalizeAspect runs,
    // closing the F-01 library-import review bypass.
    const added = incoming.map(a => normalizeAspect(sanitizeImportedAspect({ ...a, id: newId('aspect') })));
    state.aspects.push(...added);

    if (!state.currentAspectId || !state.aspects.some(a => a.id === state.currentAspectId)) {
        state.currentAspectId = added[0].id;
        try {
            localStorage.setItem('currentAspectId', state.currentAspectId);
        } catch { /* storage full / blocked */ }
        applyAspectBackground();
    }

    persistAspects();
    renderAspectList();
    window.showToast(`Imported ${added.length} Aspect(s).`);
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
    const snap = await getSnapshot(id);
    if (!snap || !Array.isArray(snap.aspects) || snap.aspects.length === 0) {
        window.showToast('That snapshot could not be read.', 'error');
        return false;
    }
    await writeSnapshot(state.aspects, 'pre-restore');
    armPersistence(); // a deliberate restore re-enables writes after a failure

    state.aspects = snap.aspects.map(a => normalizeAspect(a));
    state.currentAspectId = state.aspects[0].id;
    try {
        localStorage.setItem('currentAspectId', state.currentAspectId);
    } catch { /* storage full / blocked */ }
    applyAspectBackground();
    persistAspects();
    renderAspectList();
    if (typeof window.showChatView === 'function') window.showChatView();
    window.showToast(`Restored ${state.aspects.length} Aspect(s) from ${new Date(snap.createdAt).toLocaleString()}.`);
    return true;
}
