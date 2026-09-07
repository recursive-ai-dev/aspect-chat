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

import { STORE_ASPECTS, STORE_SNAPSHOTS, withStore, requestToPromise } from './idb.js';
import { normalizeConversations } from './conversations.js';

const LEGACY_KEY = 'aspects_data';
const LEGACY_BACKUP_KEY = 'aspects_data_v1_backup';
const MIGRATION_FLAG = 'aspects_migrated_to_idb';
const SAVE_DEBOUNCE_MS = 400;

let saveTimer = null;
let pendingSave = null;
let lastError = null;

/**
 * Persistence is "armed" only once we know the store's real contents.
 *
 * It starts armed (a fresh browser genuinely has nothing to lose). If a load
 * ever *fails* — as opposed to coming back empty — it disarms, and every write
 * becomes a no-op until a load succeeds or the user explicitly opts back in.
 *
 * Without this, a one-off IndexedDB read error (disk pressure, a profile lock,
 * a transient transaction abort) makes `loadAspects()` return `[]`, the app
 * rebuilds the default library, and the very next debounced save runs its purge
 * step — deleting every real row we simply could not read. That path is now
 * impossible: a failed load leaves persistence disarmed.
 */
let persistState = 'ready'; // 'ready' | 'failed'

export function getPersistState() {
    return persistState;
}

export function isPersistReady() {
    return persistState === 'ready';
}

/** Re-enable writes after a load failure (the user chose "start fresh"). */
export function armPersistence() {
    persistState = 'ready';
    lastError = null;
}

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

            // Purge rows for aspects deleted since the last write. Skipped for
            // an empty save: the app never legitimately drops to zero Aspects
            // (deleteCurrentAspect blocks the last one), so an empty `records`
            // here means something upstream is wrong — orphaning a row is
            // recoverable, wiping the store is not.
            if (records.length === 0) {
                console.warn('saveAspects called with no records; skipping purge to avoid a full wipe.');
                return;
            }
            const keysRequest = store.getAllKeys();
            keysRequest.onsuccess = () => {
                keysRequest.result.forEach(key => {
                    if (!keepIds.has(key)) store.delete(key);
                });
            };
        });
        lastError = null;
        maybeWriteSnapshot(aspects, 'auto');
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
    if (persistState !== 'ready') {
        // A load failed; refuse to write over data we could not read.
        return Promise.resolve();
    }

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
    if (persistState !== 'ready') return;
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
        if (!Array.isArray(rows)) throw new Error('IndexedDB returned a non-array result');
        persistState = 'ready';
        if (rows.length === 0) return [];
        const normalized = rows.map(a => normalizeConversations(a));
        // A load is a known-consistent state; keep it as a restore point.
        writeSnapshot(normalized, 'startup');
        return normalized;
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
                if (Array.isArray(parsed) && parsed.length > 0) {
                    // We recovered real data from the legacy blob — writing it
                    // back is safe, so stay armed.
                    persistState = 'ready';
                    return parsed.map(a => normalizeConversations(a));
                }
            }
        } catch { /* nothing left to try */ }

        // A genuine read failure with nothing to fall back on. Disarm writes so
        // the caller cannot rebuild-and-purge, and let it surface the error.
        persistState = 'failed';
        throw err instanceof Error ? err : new Error(String(err));
    }
}

/** Remove a single aspect's record. */
export async function deleteAspectRecord(aspectId) {
    return withStore(STORE_ASPECTS, 'readwrite', (store) => store.delete(aspectId));
}

/* ------------------------------------------------------------------ *
 * Rolling snapshots
 *
 * A safety net distinct from the user's own .aspect exports: a small,
 * automatic, timestamped history of the whole library so a bad import, a
 * mis-click, or a corrupted write is recoverable from within the app. Kept
 * newest-few only, and throttled so typing does not spawn hundreds.
 * ------------------------------------------------------------------ */

const MAX_SNAPSHOTS = 8;
const SNAPSHOT_MIN_INTERVAL_MS = 60_000;
let lastSnapshotAt = 0;

function snapshotRecords(aspects) {
    return aspects.map(a => serializeAspect(normalizeConversations(a)));
}

/** Write a snapshot now, pruning the oldest beyond MAX_SNAPSHOTS. */
export async function writeSnapshot(aspects, label = 'auto') {
    if (!Array.isArray(aspects) || aspects.length === 0) return null;
    const entry = {
        id: `snap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        createdAt: Date.now(),
        label,
        aspectCount: aspects.length,
        aspects: snapshotRecords(aspects)
    };
    try {
        await withStore(STORE_SNAPSHOTS, 'readwrite', (store) => {
            store.put(entry);
            // Prune by key: ids are `snap_<base36 timestamp>_<rand>`, so a
            // lexicographic key sort is chronological. Reading keys (not the
            // multi-MB bodies) keeps this cheap on the hot save path.
            const keysReq = store.getAllKeys();
            keysReq.onsuccess = () => {
                const keys = (keysReq.result || []).slice().sort();
                for (let i = 0; i < keys.length - MAX_SNAPSHOTS; i++) {
                    store.delete(keys[i]);
                }
            };
        });
        lastSnapshotAt = Date.now();
        return entry.id;
    } catch (err) {
        console.warn('Snapshot write failed', err && err.message);
        return null;
    }
}

/** Throttled snapshot for the hot save path. */
export function maybeWriteSnapshot(aspects, label = 'auto') {
    if (persistState !== 'ready') return;
    if (Date.now() - lastSnapshotAt < SNAPSHOT_MIN_INTERVAL_MS) return;
    lastSnapshotAt = Date.now(); // reserve the slot before the async work
    writeSnapshot(aspects, label);
}

/** Snapshot metadata, newest first (no aspect bodies). */
export async function listSnapshots() {
    try {
        const rows = await withStore(STORE_SNAPSHOTS, 'readonly', (store) => requestToPromise(store.getAll()));
        return (rows || [])
            .map(({ id, createdAt, label, aspectCount }) => ({ id, createdAt, label, aspectCount }))
            .sort((a, b) => b.createdAt - a.createdAt);
    } catch (err) {
        console.warn('Could not list snapshots', err && err.message);
        return [];
    }
}

/** Full snapshot by id, normalized and ready to load into state. */
export async function getSnapshot(id) {
    const row = await withStore(STORE_SNAPSHOTS, 'readonly', (store) => requestToPromise(store.get(id)));
    if (!row || !Array.isArray(row.aspects)) return null;
    return { ...row, aspects: row.aspects.map(a => normalizeConversations(a)) };
}

/* ------------------------------------------------------------------ *
 * Whole-library export / import (a single file, every Aspect)
 * ------------------------------------------------------------------ */

export function serializeLibrary(aspects) {
    return JSON.stringify({
        format: 'aspect-studio-library',
        version: 1,
        exportedAt: new Date().toISOString(),
        aspects: snapshotRecords(aspects)
    }, null, 2);
}

/**
 * Strip trust- and permission-bearing fields from an imported aspect's tools.
 *
 * A library JSON file is arbitrary user-supplied data that the app actively
 * encourages sharing. `trustedHash` records "the user has read this exact
 * code"; `allowNetwork` records "the user has let this tool reach the network";
 * `toolsReviewed` is the coarse editor hint. None of those decisions may be
 * asserted by the file — they are made on this machine, in the editor. We drop
 * them, keep only `{ name, code, state }`, and mark the aspect unreviewed
 * whenever it carries tools, exactly as the `.aspect` import path does
 * (`zip.js` loadAspectFile → `toolsReviewed: tools.length === 0`).
 */
function sanitizeImportedTools(aspect) {
    if (!aspect || typeof aspect !== 'object') return aspect;
    const tools = Array.isArray(aspect.tools) ? aspect.tools : [];
    aspect.tools = tools
        .filter(t => t && typeof t === 'object')
        .map(t => ({
            name: t.name,
            code: t.code,
            state: (t.state && typeof t.state === 'object') ? t.state : {}
        }));
    aspect.toolsReviewed = aspect.tools.length === 0;
    return aspect;
}

/** Parse a library file, returning normalized aspects or throwing. */
export function parseLibrary(text) {
    const data = JSON.parse(text);
    const list = Array.isArray(data) ? data : data && data.aspects;
    if (!Array.isArray(list) || list.length === 0) {
        throw new Error('No Aspects found in that file.');
    }
    return list
        .filter(a => a && typeof a === 'object')
        .map(a => normalizeConversations(sanitizeImportedTools(a)));
}

/** Test-only: clear queued work between cases. */
export function resetPersistForTesting() {
    lastSnapshotAt = 0;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    pendingSave = null;
    lastError = null;
    persistState = 'ready';
}
