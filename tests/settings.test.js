import { vi } from 'vitest';
vi.mock('../src/js/modules/aspects.js', () => ({
    cancelCreateAspect: vi.fn()
}));
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { state } from '../src/js/modules/state.js';
import {
    openSettings,
    saveSettings,
    onProviderSelect,
    fetchModelsIfPossible,
    onModelSelectDropdown,
    fetchProviderModels,
    updateModelSelectUI
} from '../src/js/modules/settings.js';

describe('Settings Module', () => {
    let mockFetch;

    beforeEach(() => {
        // Reset state
        state.settings = {
            apiUrl: '',
            apiKey: '',
            model: '',
            maxContext: 20,
            provider: ''
        };

        // Mock DOM
        document.body.innerHTML = `
            <div id="settings-modal" class="hidden"></div>
            <select id="api-provider-select">
                <option value="custom">Custom</option>
                <option value="http://localhost:1234/v1">Local</option>
                <option value="other">Other</option>
            </select>
            <input type="text" id="api-url-input" />
            <input type="password" id="api-key-input" />
            <input type="text" id="api-model-input" />
            <select id="api-model-select" class="hidden"></select>
            <input type="number" id="api-max-context-input" />
            <div id="model-fetch-status"></div>
            <input type="checkbox" id="dark-mode-toggle" />
            <div id="create-aspect-modal" class="hidden"></div>
        `;

        // Clear local/session storage
        localStorage.clear();
        sessionStorage.clear();

        // Mock fetch
        mockFetch = vi.spyOn(global, 'fetch');
    });

    afterEach(() => {
        vi.restoreAllMocks();
        document.body.className = ''; // Reset body class
    });

    describe('openSettings', () => {
        it('should remove hidden class and set display to flex', () => {
            const modal = document.getElementById('settings-modal');
            openSettings();
            expect(modal.classList.contains('hidden')).toBe(false);
            expect(modal.style.display).toBe('flex');
        });
    });

    describe('saveSettings', () => {
        it('should update state and storage, and handle dark mode', () => {
            const providerSelect = document.getElementById('api-provider-select');
            const urlInput = document.getElementById('api-url-input');
            const keyInput = document.getElementById('api-key-input');
            const modelInput = document.getElementById('api-model-input');
            const maxContextInput = document.getElementById('api-max-context-input');
            const darkModeToggle = document.getElementById('dark-mode-toggle');
            const modal = document.getElementById('settings-modal');

            providerSelect.value = 'custom';
            urlInput.value = 'https://api.openai.com/v1 '; // test trim
            keyInput.value = ' test-key ';
            modelInput.value = ' gpt-4o ';
            maxContextInput.value = '30';
            darkModeToggle.checked = true;
            sessionStorage.setItem('apiKey', 'some-key');
            localStorage.setItem('apiKey', 'some-key');

            saveSettings();

            // Assert state
            expect(state.settings.apiUrl).toBe('https://api.openai.com/v1');
            expect(state.settings.apiKey).toBe('test-key');
            expect(state.settings.model).toBe('gpt-4o');
            expect(state.settings.maxContext).toBe(30);
            expect(state.settings.provider).toBe('custom');

            // Assert localStorage
            expect(localStorage.getItem('provider')).toBe('custom');
            expect(localStorage.getItem('apiUrl')).toBe('https://api.openai.com/v1');
            expect(localStorage.getItem('model')).toBe('gpt-4o');
            expect(localStorage.getItem('maxContext')).toBe('30');
            expect(localStorage.getItem('darkMode')).toBe('true');

            // Assert cleanup
            expect(sessionStorage.getItem('apiKey')).toBeNull();
            expect(localStorage.getItem('apiKey')).toBeNull();

            // Assert UI side effects
            expect(document.body.classList.contains('dark-theme')).toBe(true);
            expect(modal.classList.contains('hidden')).toBe(true);
        });

        it('should remove dark mode if unchecked', () => {
            const darkModeToggle = document.getElementById('dark-mode-toggle');
            darkModeToggle.checked = false;
            document.body.classList.add('dark-theme');

            saveSettings();

            expect(document.body.classList.contains('dark-theme')).toBe(false);
            expect(localStorage.getItem('darkMode')).toBe('false');
        });
    });

    describe('onProviderSelect', () => {
        it('should update URL input if provider is not custom', () => {
            const providerSelect = document.getElementById('api-provider-select');
            const urlInput = document.getElementById('api-url-input');

            providerSelect.value = 'http://localhost:1234/v1';
            onProviderSelect();

            expect(urlInput.value).toBe('http://localhost:1234/v1');
        });

        it('should not update URL input if provider is custom', () => {
            const providerSelect = document.getElementById('api-provider-select');
            const urlInput = document.getElementById('api-url-input');

            urlInput.value = 'existing-url';
            providerSelect.value = 'custom';
            onProviderSelect();

            expect(urlInput.value).toBe('existing-url');
        });
    });

    describe('fetchModelsIfPossible', () => {
        it('should return early if url is empty', async () => {
            document.getElementById('api-url-input').value = '';
            await fetchModelsIfPossible();
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('should return early if provider is custom', async () => {
            document.getElementById('api-url-input').value = 'http://test';
            document.getElementById('api-provider-select').value = 'custom';
            await fetchModelsIfPossible();
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('should require API key if provider is not localhost', async () => {
            document.getElementById('api-url-input').value = 'http://test';
            document.getElementById('api-key-input').value = '';
            document.getElementById('api-provider-select').value = 'other';

            await fetchModelsIfPossible();

            expect(document.getElementById('model-fetch-status').innerText).toBe('Please enter an API key to fetch available models.');
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('should fetch successfully and populate model select', async () => {
            document.getElementById('api-url-input').value = 'http://test';
            document.getElementById('api-key-input').value = 'test-key';
            document.getElementById('api-provider-select').value = 'other';

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ data: [{ id: 'model1' }, { id: 'model2' }] })
            });

            await fetchModelsIfPossible();

            expect(mockFetch).toHaveBeenCalledWith('http://test/models', {
                headers: { 'Authorization': 'Bearer test-key' }
            });

            const modelSelect = document.getElementById('api-model-select');
            expect(modelSelect.classList.contains('hidden')).toBe(false);
            expect(modelSelect.options.length).toBe(2);
            expect(modelSelect.options[0].value).toBe('model1');

            const statusDiv = document.getElementById('model-fetch-status');
            expect(statusDiv.innerText).toBe('Models fetched successfully.');
            // Testing style color can be tricky with jsdom rgb conversion, let's just assert text
        });

        it('should handle 401 unauthorized response', async () => {
            document.getElementById('api-url-input').value = 'http://test';
            document.getElementById('api-key-input').value = 'bad-key';
            document.getElementById('api-provider-select').value = 'other';

            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 401,
                statusText: 'Unauthorized',
                json: () => Promise.resolve({ error: { message: 'Invalid token' } })
            });

            await fetchModelsIfPossible();

            const statusDiv = document.getElementById('model-fetch-status');
            expect(statusDiv.innerText).toContain('Unauthorized or invalid API key (401)');
        });
    });

    describe('onModelSelectDropdown', () => {
        it('should update api-model-input', () => {
            const modelSelect = document.getElementById('api-model-select');
            const modelInput = document.getElementById('api-model-input');

            const opt = document.createElement('option');
            opt.value = 'selected-model';
            modelSelect.appendChild(opt);
            modelSelect.value = 'selected-model';

            onModelSelectDropdown();

            expect(modelInput.value).toBe('selected-model');
        });
    });
    describe('Window Event Listeners', () => {
        describe('click event', () => {
            it('should close create-aspect-modal if clicked directly', async () => {
                const createModal = document.getElementById('create-aspect-modal');
                createModal.classList.remove('hidden');
                createModal.dispatchEvent(new Event('click', { bubbles: true }));

                expect((await import('../src/js/modules/aspects.js')).cancelCreateAspect).toHaveBeenCalled();
            });

            it('should close settings-modal if clicked directly', () => {
                const settingsModal = document.getElementById('settings-modal');
                settingsModal.classList.remove('hidden');
                settingsModal.dispatchEvent(new Event('click', { bubbles: true }));

                expect(settingsModal.classList.contains('hidden')).toBe(true);
            });
        });

        describe('keydown event', () => {
            it('should close create-aspect-modal if Escape is pressed and it is not hidden', async () => {
                const createModal = document.getElementById('create-aspect-modal');
                createModal.classList.remove('hidden');
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

                expect((await import('../src/js/modules/aspects.js')).cancelCreateAspect).toHaveBeenCalled();
            });

            it('should close settings-modal if Escape is pressed and it is not hidden', () => {
                const settingsModal = document.getElementById('settings-modal');
                settingsModal.classList.remove('hidden');
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

                expect(settingsModal.classList.contains('hidden')).toBe(true);
            });

            it('should do nothing if another key is pressed', async () => {
                const settingsModal = document.getElementById('settings-modal');
                settingsModal.classList.remove('hidden');
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

                expect(settingsModal.classList.contains('hidden')).toBe(false);
                // expect((await import('../src/js/modules/aspects.js')).cancelCreateAspect).not.toHaveBeenCalled();
            });
        });
    });

    describe('fetchProviderModels error handling', () => {
        it('should throw an error if response is not ok and no error message', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
                json: () => Promise.reject(new Error('no json'))
            });
            await expect(fetchProviderModels('http://test', 'key')).rejects.toThrow('Error 500: Internal Server Error');
        });

        it('should throw Rate limit exceeded for 429', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 429,
                statusText: 'Too Many Requests',
                json: () => Promise.resolve({})
            });
            await expect(fetchProviderModels('http://test', 'key')).rejects.toThrow('Rate limit exceeded (429).');
        });

        it('should throw No models found if models array is empty', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ data: [] })
            });
            await expect(fetchProviderModels('http://test', 'key')).rejects.toThrow('No models found.');
        });

        it('should append /models to url if it lacks it', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ data: [{id: 'model1'}] })
            });
            await fetchProviderModels('http://test', 'key');
            expect(mockFetch).toHaveBeenCalledWith('http://test/models', expect.anything());
        });

        it('should handle missing error.message', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
                json: () => Promise.resolve({})
            });
            await expect(fetchProviderModels('http://test', 'key')).rejects.toThrow('Error 500: Internal Server Error');
        });

        it('should handle data without data or models array', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ notmodels: [] })
            });
            await expect(fetchProviderModels('http://test', 'key')).rejects.toThrow('No models found.');
        });

        it('should handle json parsing error when extracting error message', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 400,
                statusText: 'Bad Request',
                json: () => Promise.reject(new Error('SyntaxError'))
            });
            await expect(fetchProviderModels('http://test', 'key')).rejects.toThrow('Error 400: Bad Request');
        });

        it('should handle custom error format from json', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 400,
                statusText: 'Bad Request',
                json: () => Promise.resolve({ message: 'Custom bad error' })
            });
            await expect(fetchProviderModels('http://test', 'key')).rejects.toThrow('Error 400: Custom bad error');
        });

        it('should extract error message from errData.message if errData.error is undefined', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 400,
                statusText: 'Bad Request',
                json: () => Promise.resolve({ message: 'Custom bad error format 2' })
            });
            await expect(fetchProviderModels('http://test', 'key')).rejects.toThrow('Error 400: Custom bad error format 2');
        });

        it('should handle 403 response', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 403,
                statusText: 'Forbidden',
                json: () => Promise.resolve({})
            });
            await expect(fetchProviderModels('http://test', 'key')).rejects.toThrow('Unauthorized or invalid API key (403).');
        });

        it('should handle missing error.message correctly (falling back to errData.message)', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 400,
                statusText: 'Bad Request',
                json: () => Promise.resolve({ error: { notmessage: 'test' }, message: 'Fallback msg' })
            });
            await expect(fetchProviderModels('http://test', 'key')).rejects.toThrow('Error 400: Fallback msg');
        });

        it('should NOT append /models to url if it ends with /models', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ data: [{id: 'model1'}] })
            });
            await fetchProviderModels('http://test/models', 'key');
            expect(mockFetch).toHaveBeenCalledWith('http://test/models', expect.anything());
        });

        it('should NOT append /models to url if it ends with /models/', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ data: [{id: 'model1'}] })
            });
            await fetchProviderModels('http://test/models/', 'key');
            expect(mockFetch).toHaveBeenCalledWith('http://test/models/', expect.anything());
        });
    });

    describe('updateModelSelectUI else branch', () => {

        it('should set modelSelect.value if input value exists in options', () => {
            const modelSelect = document.getElementById('api-model-select');
            const modelInput = document.getElementById('api-model-input');
            const statusDiv = document.getElementById('model-fetch-status');

            modelInput.value = 'model1';

            updateModelSelectUI([{id: 'model1'}, {id: 'model2'}], modelSelect, modelInput, statusDiv);

            expect(modelSelect.value).toBe('model1');
        });
    });

    describe('fetchModelsIfPossible catch block', () => {
        it('should update statusDiv on error', async () => {
            document.getElementById('api-url-input').value = 'http://test';
            document.getElementById('api-key-input').value = 'test-key';
            document.getElementById('api-provider-select').value = 'other';

            mockFetch.mockRejectedValueOnce(new Error('Network error'));
            await fetchModelsIfPossible();

            const statusDiv = document.getElementById('model-fetch-status');
            expect(statusDiv.innerText).toBe('Network error');
        });
    });

});
