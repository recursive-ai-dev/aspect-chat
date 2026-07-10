import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadAspectFile } from '../src/js/modules/zip.js';
import JSZip from 'jszip';

vi.mock('jszip', () => {
    return {
        default: {
            loadAsync: vi.fn()
        }
    };
});

describe('Zip Module', () => {
    beforeEach(() => {
        window.showToast = vi.fn();
        console.error = vi.fn();
    });

    it('handles bad zip format when loading aspect file', async () => {
        const mockError = new Error('Corrupted zip');
        JSZip.loadAsync.mockRejectedValue(mockError);

        const mockFile = new File([''], 'bad.aspect');
        const event = {
            target: {
                files: [mockFile],
                value: 'some/path.aspect'
            }
        };

        await loadAspectFile(event);

        expect(JSZip.loadAsync).toHaveBeenCalledWith(mockFile);
        expect(console.error).toHaveBeenCalledWith('Error loading .aspect file', mockError);
        expect(window.showToast).toHaveBeenCalledWith(`Error loading .aspect file: ${mockError.message}`, 'error');
        expect(event.target.value).toBe('');
    });
});
