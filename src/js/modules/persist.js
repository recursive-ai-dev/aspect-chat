/**
 * Aspect persistence.
 *
 * Aspects used to live in localStorage as one JSON blob. With base64 icons,
 * base64 backgrounds and full chat history in the same string, that blob hits
 * the ~5MB quota and every subsequent write throws — silently, because the old
 * write had no error handling. Everything after that point was simply lost.
 *
 * Aspects now live in IndexedDB, which has orders of magnitude more room and
 * reports failures. Writes are debounced so typing in the editor does not
 * serialise the whole library on every keystroke.
 */

import { STORE_ASPECTS, withStore, requestToPromise } from './idb.js';
import { normalizeConversations } from './conversations.js';

const LEGACY_KEY = 'aspects_data';
const LEGACY_BACKUP_KEY = 'aspects_data_v1_backup';
const MIGRATION_FLAG = 'aspects_migrated_to_idb';
const SAVE_DEBOUNCE_MS = 400;

let saveTimer = null;
let pendingSave = null;
let lastError = null;

/**
 * Strip runtime-only fields before writing.
 *
 * `chatHistory` is a live alias of the active conversation's message array —
 * persisting it would duplicate every message on disk and let the two copies
 * drift apart on reload. `_renderedHtml` / `_renderedContent` are render caches
 * and `_isEditing` is transient UI state.
 */
export function serializeAspect(aspect) {
    const { chatHistory, ...rest } = aspect;

    return {
        ...rest,
        conversations: (aspect.conversations || []).map(conv => ({
            id: conv.id,
            title: conv.title,
            titleLocked: !!conv.titleLocked,
            createdAt: conv.createdAt,
            updatedAt: conv.updatedAt,
            messages: (conv.messages || []).map(({ _renderedHtml, _renderedContent, _isEditing, ...msg }) => msg)
        }))
    };
}

/** Write every aspect in one transaction, removing any that were deleted. */
export async function saveAspects(aspects) {
    const records = aspects.map(a => serializeAspect(normalizeConversations(a)));
    const keepIds = new Set(records.map(r => r.id));

    try {
        await withStore(STORE_ASPECTS, 'readwrite', (store) => {
            records.forEach(record => store.put(record));

            // Purge rows for aspects deleted since the last write.
            const keysRequest = store.getAllKeys();
            keysRequest.onsuccess = () => {
                keysRequest.result.forEach(key => {
                    if (!keepIds.has(key)) store.delete(key);
                });
            };
        });
        lastError = null;
    } catch (err) {
        lastError = err;
        throw err;
    }
}

/**
 * Queue a save. Repeated calls inside the debounce window collapse into one
 * write, and callers can await the returned promise to know it landed.
 */
export function scheduleSave(aspects) {
    if (saveTimer) clearTimeout(saveTimer);

    if (!pendingSave) {
        pendingSave = {};
        pendingSave.promise = new Promise((resolve, reject) => {
            pendingSave.resolve = resolve;
            pendingSave.reject = reject;
        });
        // A caller that never awaits should not produce an unhandled rejection.
        pendingSave.promise.catch(() => {});
    }
    pendingSave.aspects = aspects;

    const entry = pendingSave;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        pendingSave = null;
        saveAspects(entry.aspects).then(entry.resolve, entry.reject);
    }, SAVE_DEBOUNCE_MS);

    return pendingSave.promise;
}

/** Write any queued changes immediately. */
export async function flushSave() {
    if (!pendingSave) return;
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    const entry = pendingSave;
    pendingSave = null;
    try {
        await saveAspects(entry.aspects);
        entry.resolve();
    } catch (err) {
        entry.reject(err);
        throw err;
    }
}

/** The most recent persistence failure, if any. */
export function getLastPersistError() {
    return lastError;
}

async function readAllAspects() {
    return withStore(STORE_ASPECTS, 'readonly', (store) => requestToPromise(store.getAll()))
        .then(inner => inner);
}

/**
 * Move a pre-IndexedDB library across, once.
 *
 * The original localStorage blob is kept under a backup key rather than
 * deleted: if anything about the migration is wrong, the user's Aspects are
 * still recoverable from their browser rather than gone.
 */
export async function migrateFromLocalStorage() {
    if (typeof localStorage === 'undefined') return null;
    if (localStorage.getItem(MIGRATION_FLAG) === 'true') return null;

    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) {
        try { localStorage.setItem(MIGRATION_FLAG, 'true'); } catch { /* quota — retry next load */ }
        return null;
    }

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        console.error('Legacy aspects_data was not valid JSON; leaving it untouched.', err);
        return null;
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
        try { localStorage.setItem(MIGRATION_FLAG, 'true'); } catch { /* ignore */ }
        return null;
    }

    const normalized = parsed.map(a => normalizeConversations(a));
    await saveAspects(normalized);

    try {
        localStorage.setItem(LEGACY_BACKUP_KEY, raw);
        localStorage.removeItem(LEGACY_KEY);
        localStorage.setItem(MIGRATION_FLAG, 'true');
    } catch (err) {
        // The data is safely in IndexedDB; a failed bookkeeping write only
        // means we re-check (and no-op) on the next load.
        console.warn('Could not update localStorage after migration', err.message);
    }

    return normalized;
}

/**
 * Load the Aspect library, migrating legacy storage on first run.
 * Returns an empty array when nothing has been saved yet.
 */
export async function loadAspects() {
    try {
        const migrated = await migrateFromLocalStorage();
        if (migrated && migrated.length > 0) return migrated;
    } catch (err) {
        console.error('Aspect migration from localStorage failed', err);
    }

    try {
        const rows = await readAllAspects();
        if (!Array.isArray(rows) || rows.length === 0) return [];
        return rows.map(a => normalizeConversations(a));
    } catch (err) {
        lastError = err;
        console.error('Failed to load Aspects from IndexedDB', err);

        // Last resort: if IndexedDB is unavailable (private mode, disabled
        // storage), fall back to whatever legacy blob is still around so the
        // user sees their Aspects instead of an empty studio.
        try {
            const raw = (typeof localStorage !== 'undefined')
                && (localStorage.getItem(LEGACY_KEY) || localStorage.getItem(LEGACY_BACKUP_KEY));
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed.map(a => normalizeConversations(a));
            }
        } catch { /* nothing left to try */ }

        return [];
    }
}

/** Remove a single aspect's record. */
export async function deleteAspectRecord(aspectId) {
    return withStore(STORE_ASPECTS, 'readwrite', (store) => store.delete(aspectId));
}

/** Test-only: clear queued work between cases. */
export function resetPersistForTesting() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    pendingSave = null;
    lastError = null;
}
