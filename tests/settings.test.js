import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { state } from '../src/js/modules/state.js';
import {
    openSettings,
    saveSettings,
    onProviderSelect,
    fetchModelsIfPossible,
    onModelSelectDropdown
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
});
