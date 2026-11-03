/**
 * Shared IndexedDB connection.
 *
 * One database, opened once, used by both the knowledge/memory stores (db.js)
 * and the Aspect store (persist.js). Keeping the connection in a single module
 * means there is exactly one `onupgradeneeded` handler and no risk of two
 * modules racing to open the same database at different versions.
 */

export const DB_NAME = 'AspectKnowledgeDB';
export const DB_VERSION = 5;

export const STORE_FILES = 'files';
export const STORE_MEMORY = 'memory';
export const STORE_ASPECTS = 'aspects';
export const STORE_SNAPSHOTS = 'snapshots';

let dbPromise = null;
let connection = null;

function invalidate(db) {
    if (connection === db) {
        connection = null;
        dbPromise = null;
    }
}

function openDatabase() {
    return new Promise((resolve, reject) => {
        let request;
        let failed = false;
        try {
            request = indexedDB.open(DB_NAME, DB_VERSION);
        } catch (err) {
            reject(err);
            return;
        }

        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('vectors')) {
                const vectors = db.createObjectStore('vectors', { keyPath: ['aspectId', 'name', 'chunkIndex'] });
                vectors.createIndex('aspectId', 'aspectId');
            }
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
            // A blocked request cannot be cancelled. Close its late result
            // after rejection rather than retaining an unreachable connection.
            if (failed) {
                db.close();
                return;
            }
            connection = db;
            // Another tab upgrading the schema would otherwise block forever.
            db.onversionchange = () => { db.close(); invalidate(db); };
            db.onclose = () => invalidate(db);
            resolve(db);
        };
        request.onerror = (e) => { failed = true; reject(e.target.error); };
        request.onblocked = () => {
            failed = true;
            reject(new Error('The Aspect Studio database is open in another tab running an older version. Close that tab and retry.'));
        };
    });
}

export function getDB() {
    if (!dbPromise) {
        const attempt = openDatabase();
        dbPromise = attempt;
        attempt.catch(() => {
            if (dbPromise === attempt) dbPromise = null;
        });
    }
    return dbPromise;
}

/** Acquire a transaction, reopening a closed cached connection once. */
export async function createTransaction(storeName, mode = 'readonly') {
    let db = await getDB();
    let tx;
    try {
        tx = db.transaction(storeName, mode);
    } catch (err) {
        // Retrying transaction *creation* is safe: no callback or write has
        // run. Never retry an aborted transaction or its side effects.
        if (err.name !== 'InvalidStateError') throw err;
        invalidate(db);
        db = await getDB();
        tx = db.transaction(storeName, mode);
    }
    return tx;
}

/** Run `fn(store)` inside a transaction and resolve when it commits. */
export async function withStore(storeName, mode, fn) {
    const tx = await createTransaction(storeName, mode);
    return new Promise((resolve, reject) => {
        let result;
        try {
            result = fn(tx.objectStore(storeName), tx);
            // A failed request may reject before onabort rejects the outer
            // transaction promise. Attach a handler immediately in that case.
            if (result?.then) Promise.resolve(result).catch(() => {});
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
    if (connection) connection.close();
    connection = null;
    dbPromise = null;
    return getDB();
}
