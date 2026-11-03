import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => vi.restoreAllMocks());

describe('database connection ownership', () => {
    it('retries a failed initial open and coalesces concurrent acquisitions', async () => {
        vi.resetModules();
        const idb = await import('../src/js/modules/idb.js');
        const spy = vi.spyOn(indexedDB, 'open').mockImplementationOnce(() => { throw new Error('storage unavailable'); });
        await expect(idb.getDB()).rejects.toThrow('storage unavailable');
        const [first, second] = await Promise.all([idb.getDB(), idb.getDB()]);
        expect(first).toBe(second);
        expect(spy).toHaveBeenCalledTimes(2);
        first.close();
    });

    it('reopens after versionchange rather than reusing the closed handle', async () => {
        vi.resetModules();
        const idb = await import('../src/js/modules/idb.js');
        const first = await idb.getDB();
        first.onversionchange();
        const second = await idb.getDB();
        expect(second).not.toBe(first);
        await expect(idb.withStore(idb.STORE_ASPECTS, 'readonly', s => idb.requestToPromise(s.count()))).resolves.toBeTypeOf('number');
        second.close();
    });

    it('retries transaction creation after explicit connection close without repeating callback writes', async () => {
        vi.resetModules();
        const idb = await import('../src/js/modules/idb.js');
        (await idb.getDB()).close();
        const callback = vi.fn(store => idb.requestToPromise(store.count()));
        await idb.withStore(idb.STORE_ASPECTS, 'readonly', callback);
        expect(callback).toHaveBeenCalledOnce();
        (await idb.getDB()).close();
    });

    it('closes late success from a blocked open and allows a fresh attempt', async () => {
        vi.resetModules();
        const request = {};
        const idb = await import('../src/js/modules/idb.js');
        const spy = vi.spyOn(indexedDB, 'open').mockReturnValueOnce(request);
        const pending = idb.getDB();
        request.onblocked();
        await expect(pending).rejects.toThrow('another tab');
        const late = { close: vi.fn() };
        request.onsuccess({ target: { result: late } });
        expect(late.close).toHaveBeenCalledOnce();
        (await idb.getDB()).close();
        expect(spy).toHaveBeenCalledTimes(2);
    });
});
