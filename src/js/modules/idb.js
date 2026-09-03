/**
 * Shared IndexedDB connection.
 *
 * One database, opened once, used by both the knowledge/memory stores (db.js)
 * and the Aspect store (persist.js). Keeping the connection in a single module
 * means there is exactly one `onupgradeneeded` handler and no risk of two
 * modules racing to open the same database at different versions.
 */

export const DB_NAME = 'AspectKnowledgeDB';
export const DB_VERSION = 4;

export const STORE_FILES = 'files';
export const STORE_MEMORY = 'memory';
export const STORE_ASPECTS = 'aspects';
export const STORE_SNAPSHOTS = 'snapshots';

function openDatabase() {
    return new Promise((resolve, reject) => {
        let request;
        try {
            request = indexedDB.open(DB_NAME, DB_VERSION);
        } catch (err) {
            reject(err);
            return;
        }

        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_FILES)) {
                db.createObjectStore(STORE_FILES, { keyPath: ['aspectId', 'name'] });
            }
            if (!db.objectStoreNames.contains(STORE_MEMORY)) {
                db.createObjectStore(STORE_MEMORY, { keyPath: 'aspectId' });
            }
            if (!db.objectStoreNames.contains(STORE_ASPECTS)) {
                db.createObjectStore(STORE_ASPECTS, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
                db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'id' });
            }
        };

        request.onsuccess = (e) => {
            const db = e.target.result;
            // Another tab upgrading the schema would otherwise block forever.
            db.onversionchange = () => db.close();
            resolve(db);
        };
        request.onerror = (e) => reject(e.target.error);
        request.onblocked = () => reject(new Error(
            'The Aspect Studio database is open in another tab running an older version. Close that tab and reload.'
        ));
    });
}

let dbPromise = openDatabase();

export function getDB() {
    return dbPromise;
}

/** Run `fn(store)` inside a transaction and resolve when it commits. */
export async function withStore(storeName, mode, fn) {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
        let tx;
        try {
            tx = db.transaction(storeName, mode);
        } catch (err) {
            reject(err);
            return;
        }
        let result;
        try {
            result = fn(tx.objectStore(storeName), tx);
        } catch (err) {
            try { tx.abort(); } catch { /* already aborting */ }
            reject(err);
            return;
        }
        tx.oncomplete = () => resolve(result);
        tx.onerror = (e) => reject(e.target.error);
        tx.onabort = (e) => reject(e.target.error || new Error('Transaction aborted'));
    });
}

/** Promisified wrapper for a single IDBRequest. */
export function requestToPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

/** Test-only: reopen the connection after fake-indexeddb is reset. */
export function resetDatabaseForTesting() {
    dbPromise = openDatabase();
    return dbPromise;
}
