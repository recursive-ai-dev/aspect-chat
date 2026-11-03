import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { saveBlob, MAX_EXPORT_BYTES } from '../src/js/modules/download.js';

const native = vi.hoisted(() => ({ getPlatform: vi.fn(), begin: vi.fn(), append: vi.fn(), save: vi.fn(), discard: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: native.getPlatform }, registerPlugin: () => native }));

describe('portable download adapter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        native.getPlatform.mockReturnValue('android');
        native.begin.mockResolvedValue({ token: 'token' });
        native.append.mockResolvedValue({});
        native.save.mockResolvedValue({ cancelled: false });
        native.discard.mockResolvedValue({});
    });
    afterEach(() => { vi.useRealTimers(); });

    it('streams bounded chunks in order and waits for document completion', async () => {
        const bytes = new Uint8Array(400000);
        for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
        expect(await saveBlob(new Blob([bytes]), 'library.aspect', 'application/zip')).toBe(true);
        expect(native.begin).toHaveBeenCalledWith({ filename: 'library.aspect', mimeType: 'application/zip' });
        expect(native.append).toHaveBeenCalledTimes(3);
        const chunks = native.append.mock.calls.map(([arg]) => Uint8Array.from(atob(arg.base64), c => c.charCodeAt(0)));
        expect(chunks.every(chunk => chunk.length <= 192 * 1024)).toBe(true);
        expect(Buffer.concat(chunks)).toEqual(Buffer.from(bytes));
        expect(native.save.mock.invocationCallOrder[0]).toBeGreaterThan(native.append.mock.invocationCallOrder[2]);
        expect(native.discard).toHaveBeenCalledWith({ token: 'token' });
    });

    it('distinguishes cancellation, zero-byte saves and provider failures', async () => {
        native.save.mockResolvedValueOnce({ cancelled: true });
        expect(await saveBlob(new Blob([]), 'empty.json', 'application/json')).toBe(false);
        expect(native.append).not.toHaveBeenCalled();
        native.save.mockRejectedValueOnce(new Error('Provider unavailable'));
        await expect(saveBlob(new Blob(['data']), 'library.json', 'application/json')).rejects.toThrow('Provider unavailable');
        expect(native.discard).toHaveBeenCalledTimes(2);
    });

    it('cleans staging after an interrupted chunk and does not open the picker', async () => {
        native.append.mockRejectedValueOnce(new Error('No space'));
        await expect(saveBlob(new Blob(['data']), 'library.json', 'application/json')).rejects.toThrow('No space');
        expect(native.save).not.toHaveBeenCalled();
        expect(native.discard).toHaveBeenCalledWith({ token: 'token' });
    });

    it('rejects malformed completion and never discards another active export', async () => {
        native.save.mockResolvedValueOnce({});
        await expect(saveBlob(new Blob(['data']), 'library.json')).rejects.toThrow('invalid save result');
        expect(native.discard).toHaveBeenCalledTimes(1);
        vi.clearAllMocks();
        native.begin.mockRejectedValueOnce(new Error('Another export is in progress'));
        await expect(saveBlob(new Blob(['data']), 'library.json')).rejects.toThrow('Another export');
        expect(native.append).not.toHaveBeenCalled();
        expect(native.save).not.toHaveBeenCalled();
        expect(native.discard).not.toHaveBeenCalled();
    });

    it('rejects path injection and oversized data before invoking native code', async () => {
        for (const name of ['', '../outside', 'dir\\file', 'x\nfile', 'x'.repeat(181)]) {
            await expect(saveBlob(new Blob([]), name)).rejects.toThrow('filename');
        }
        await expect(saveBlob({ size: MAX_EXPORT_BYTES + 1 }, 'large.aspect')).rejects.toThrow('50MB');
        expect(native.begin).not.toHaveBeenCalled();
    });

    it('keeps browser blob URLs alive through asynchronous download dispatch', async () => {
        native.getPlatform.mockReturnValue('web');
        vi.useFakeTimers();
        URL.createObjectURL = vi.fn(() => 'blob:export');
        URL.revokeObjectURL = vi.fn();
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        expect(await saveBlob(new Blob(['data']), 'library.json')).toBe(true);
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1000);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:export');
        expect(native.begin).not.toHaveBeenCalled();
    });
});
