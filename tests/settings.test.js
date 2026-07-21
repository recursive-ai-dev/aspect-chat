import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/dom';
import '@testing-library/jest-dom';
import { http, HttpResponse } from 'msw';
import { server } from './mocks/server.js';
import { state } from '../src/js/modules/state.js';

// Mock aspect.js
vi.mock('../src/js/modules/aspects.js', () => ({
    cancelCreateAspect: vi.fn()
}));

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
            <div id="settings-modal" class="hidden" data-testid="settings-modal"></div>
            <select id="api-provider-select" data-testid="provider-select">
                <option value="custom">Custom</option>
                <option value="http://localhost:1234/v1">Local</option>
                <option value="other">Other</option>
            </select>
            <input type="text" id="api-url-input" data-testid="url-input" />
            <input type="password" id="api-key-input" data-testid="key-input" />
            <input type="text" id="api-model-input" data-testid="model-input" />
            <select id="api-model-select" class="hidden" data-testid="model-select"></select>
            <input type="number" id="api-max-context-input" data-testid="max-context-input" />
            <div id="model-fetch-status" data-testid="fetch-status"></div>
            <input type="checkbox" id="dark-mode-toggle" data-testid="dark-mode-toggle" />
            <div id="create-aspect-modal" class="hidden" data-testid="create-aspect-modal"></div>
        `;

        // Clear local/session storage
        localStorage.clear();
        sessionStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        server.resetHandlers();
        document.body.className = '';
    });

    describe('openSettings', () => {
        it('should remove hidden class and set display to flex', () => {
            const modal = screen.getByTestId('settings-modal');
            openSettings();
            expect(modal).not.toHaveClass('hidden');
            expect(modal.style.display).toBe('flex');
        });
    });

    describe('saveSettings', () => {
        it('should update state and storage, and handle dark mode', () => {
            const providerSelect = screen.getByTestId('provider-select');
            const urlInput = screen.getByTestId('url-input');
            const keyInput = screen.getByTestId('key-input');
            const modelInput = screen.getByTestId('model-input');
            const maxContextInput = screen.getByTestId('max-context-input');
            const darkModeToggle = screen.getByTestId('dark-mode-toggle');
            const modal = screen.getByTestId('settings-modal');

            providerSelect.value = 'custom';
            urlInput.value = 'https://api.openai.com/v1 '; // test trim
            keyInput.value = ' test-key ';
            modelInput.value = ' gpt-4o ';
            maxContextInput.value = '30';
            darkModeToggle.checked = true;
            sessionStorage.setItem('apiKey', 'some-key');
            localStorage.setItem('apiKey', 'some-key');

            saveSettings();

            expect(state.settings.apiUrl).toBe('https://api.openai.com/v1');
            expect(state.settings.apiKey).toBe('test-key');
            expect(state.settings.model).toBe('gpt-4o');
            expect(state.settings.maxContext).toBe(30);
            expect(state.settings.provider).toBe('custom');

            expect(localStorage.getItem('provider')).toBe('custom');
            expect(localStorage.getItem('apiUrl')).toBe('https://api.openai.com/v1');
            expect(localStorage.getItem('model')).toBe('gpt-4o');
            expect(localStorage.getItem('maxContext')).toBe('30');
            expect(localStorage.getItem('darkMode')).toBe('true');

            expect(sessionStorage.getItem('apiKey')).toBeNull();
            expect(localStorage.getItem('apiKey')).toBeNull();

            expect(document.body).toHaveClass('dark-theme');
            expect(modal).toHaveClass('hidden');
        });

        it('should remove dark mode if unchecked', () => {
            const darkModeToggle = screen.getByTestId('dark-mode-toggle');
            darkModeToggle.checked = false;
            document.body.classList.add('dark-theme');

            saveSettings();

            expect(document.body).not.toHaveClass('dark-theme');
            expect(localStorage.getItem('darkMode')).toBe('false');
        });
    });

    describe('onProviderSelect', () => {
        it('should update URL input if provider is not custom', () => {
            const providerSelect = screen.getByTestId('provider-select');
            const urlInput = screen.getByTestId('url-input');

            providerSelect.value = 'http://localhost:1234/v1';
            onProviderSelect();

            expect(urlInput).toHaveValue('http://localhost:1234/v1');
        });

        it('should not update URL input if provider is custom', () => {
            const providerSelect = screen.getByTestId('provider-select');
            const urlInput = screen.getByTestId('url-input');

            urlInput.value = 'existing-url';
            providerSelect.value = 'custom';
            onProviderSelect();

            expect(urlInput).toHaveValue('existing-url');
        });
    });

    describe('fetchModelsIfPossible', () => {
        it('should return early if url is empty', async () => {
            screen.getByTestId('url-input').value = '';
            let fetched = false;
            server.use(http.get('*/models', () => { fetched = true; return HttpResponse.json({data: []}); }));
            await fetchModelsIfPossible();
            expect(fetched).toBe(false);
        });

        it('should return early if provider is custom', async () => {
            screen.getByTestId('url-input').value = 'http://api.example.com';
            screen.getByTestId('provider-select').value = 'custom';
            let fetched = false;
            server.use(http.get('*/models', () => { fetched = true; return HttpResponse.json({data: []}); }));
            await fetchModelsIfPossible();
            expect(fetched).toBe(false);
        });

        it('should require API key if provider is not localhost', async () => {
            screen.getByTestId('url-input').value = 'http://api.example.com';
            screen.getByTestId('key-input').value = '';
            screen.getByTestId('provider-select').value = 'other';

            await fetchModelsIfPossible();

            expect(screen.getByTestId('fetch-status').innerText).toBe('Please enter an API key to fetch available models.');
        });

        it('should fetch successfully and populate model select', async () => {
            screen.getByTestId('url-input').value = 'http://api.example.com';
            screen.getByTestId('key-input').value = 'test-key';
            screen.getByTestId('provider-select').value = 'other';

            server.use(
                http.get('http://api.example.com/models', ({ request }) => {
                    expect(request.headers.get('Authorization')).toBe('Bearer test-key');
                    return HttpResponse.json({ data: [{ id: 'model1' }, { id: 'model2' }] });
                })
            );

            await fetchModelsIfPossible();

            const modelSelect = screen.getByTestId('model-select');
            expect(modelSelect).not.toHaveClass('hidden');
            expect(modelSelect.options.length).toBe(2);
            expect(modelSelect.options[0].value).toBe('model1');

            expect(screen.getByTestId('fetch-status').innerText).toBe('Models fetched successfully.');
        });

        it('should handle 401 unauthorized response', async () => {
            screen.getByTestId('url-input').value = 'http://api.example.com';
            screen.getByTestId('key-input').value = 'bad-key';
            screen.getByTestId('provider-select').value = 'other';

            server.use(
                http.get('http://api.example.com/models', () => {
                    return HttpResponse.json({ error: { message: 'Invalid token' } }, { status: 401, statusText: 'Unauthorized' });
                })
            );

            await fetchModelsIfPossible();

            expect(screen.getByTestId('fetch-status').innerText).toContain('Unauthorized or invalid API key (401)');
        });
        
        it('should update statusDiv on network error', async () => {
            screen.getByTestId('url-input').value = 'http://api.example.com';
            screen.getByTestId('key-input').value = 'test-key';
            screen.getByTestId('provider-select').value = 'other';

            server.use(
                http.get('http://api.example.com/models', () => {
                    return HttpResponse.error();
                })
            );
            await fetchModelsIfPossible();

            expect(screen.getByTestId('fetch-status').innerText).toMatch(/Failed to fetch/);
        });
    });

    describe('onModelSelectDropdown', () => {
        it('should update api-model-input', () => {
            const modelSelect = screen.getByTestId('model-select');
            const modelInput = screen.getByTestId('model-input');

            const opt = document.createElement('option');
            opt.value = 'selected-model';
            modelSelect.appendChild(opt);
            modelSelect.value = 'selected-model';

            onModelSelectDropdown();

            expect(modelInput).toHaveValue('selected-model');
        });
    });

    describe('Window Event Listeners', () => {
        describe('click event', () => {
            it('should close create-aspect-modal if clicked directly', async () => {
                const createModal = screen.getByTestId('create-aspect-modal');
                createModal.classList.remove('hidden');
                fireEvent.click(createModal);

                expect((await import('../src/js/modules/aspects.js')).cancelCreateAspect).toHaveBeenCalled();
            });

            it('should close settings-modal if clicked directly', () => {
                const settingsModal = screen.getByTestId('settings-modal');
                settingsModal.classList.remove('hidden');
                fireEvent.click(settingsModal);

                expect(settingsModal).toHaveClass('hidden');
            });
        });

        describe('keydown event', () => {
            it('should close create-aspect-modal if Escape is pressed and it is not hidden', async () => {
                const createModal = screen.getByTestId('create-aspect-modal');
                createModal.classList.remove('hidden');
                fireEvent.keyDown(window, { key: 'Escape' });

                expect((await import('../src/js/modules/aspects.js')).cancelCreateAspect).toHaveBeenCalled();
            });

            it('should close settings-modal if Escape is pressed and it is not hidden', () => {
                const settingsModal = screen.getByTestId('settings-modal');
                settingsModal.classList.remove('hidden');
                fireEvent.keyDown(window, { key: 'Escape' });

                expect(settingsModal).toHaveClass('hidden');
            });

            it('should do nothing if another key is pressed', async () => {
                const settingsModal = screen.getByTestId('settings-modal');
                settingsModal.classList.remove('hidden');
                fireEvent.keyDown(window, { key: 'Enter' });

                expect(settingsModal).not.toHaveClass('hidden');
            });
        });
    });

    describe('fetchProviderModels error handling', () => {
        it('should throw an error if response is not ok and no error message', async () => {
            server.use(
                http.get('http://api.example.com/models', () => {
                    return new HttpResponse('no json', { status: 500, statusText: 'Internal Server Error' });
                })
            );
            await expect(fetchProviderModels('http://api.example.com', 'key')).rejects.toThrow('Error 500: Internal Server Error');
        });

        it('should throw Rate limit exceeded for 429', async () => {
            server.use(
                http.get('http://api.example.com/models', () => {
                    return HttpResponse.json({}, { status: 429, statusText: 'Too Many Requests' });
                })
            );
            await expect(fetchProviderModels('http://api.example.com', 'key')).rejects.toThrow('Rate limit exceeded (429).');
        });

        it('should throw No models found if models array is empty', async () => {
            server.use(
                http.get('http://api.example.com/models', () => {
                    return HttpResponse.json({ data: [] });
                })
            );
            await expect(fetchProviderModels('http://api.example.com', 'key')).rejects.toThrow('No models found.');
        });

        it('should append /models to url if it lacks it', async () => {
            let fetchedUrl = '';
            server.use(
                http.get('http://api.example.com/models', ({ request }) => {
                    fetchedUrl = request.url;
                    return HttpResponse.json({ data: [{id: 'model1'}] });
                })
            );
            await fetchProviderModels('http://api.example.com', 'key');
            expect(fetchedUrl).toBe('http://api.example.com/models');
        });

        it('should handle data without data or models array', async () => {
            server.use(
                http.get('http://api.example.com/models', () => {
                    return HttpResponse.json({ notmodels: [] });
                })
            );
            await expect(fetchProviderModels('http://api.example.com', 'key')).rejects.toThrow('No models found.');
        });

        it('should handle custom error format from json', async () => {
            server.use(
                http.get('http://api.example.com/models', () => {
                    return HttpResponse.json({ message: 'Custom bad error' }, { status: 400, statusText: 'Bad Request' });
                })
            );
            await expect(fetchProviderModels('http://api.example.com', 'key')).rejects.toThrow('Error 400: Custom bad error');
        });

        it('should extract error message from errData.message if errData.error is undefined', async () => {
            server.use(
                http.get('http://api.example.com/models', () => {
                    return HttpResponse.json({ message: 'Custom bad error format 2' }, { status: 400, statusText: 'Bad Request' });
                })
            );
            await expect(fetchProviderModels('http://api.example.com', 'key')).rejects.toThrow('Error 400: Custom bad error format 2');
        });

        it('should handle 403 response', async () => {
            server.use(
                http.get('http://api.example.com/models', () => {
                    return HttpResponse.json({}, { status: 403, statusText: 'Forbidden' });
                })
            );
            await expect(fetchProviderModels('http://api.example.com', 'key')).rejects.toThrow('Unauthorized or invalid API key (403).');
        });

        it('should handle missing error.message correctly (falling back to errData.message)', async () => {
            server.use(
                http.get('http://api.example.com/models', () => {
                    return HttpResponse.json({ error: { notmessage: 'test' }, message: 'Fallback msg' }, { status: 400, statusText: 'Bad Request' });
                })
            );
            await expect(fetchProviderModels('http://api.example.com', 'key')).rejects.toThrow('Error 400: Fallback msg');
        });

        it('should NOT append /models to url if it ends with /models', async () => {
            let fetchedUrl = '';
            server.use(
                http.get('http://api.example.com/models', ({ request }) => {
                    fetchedUrl = request.url;
                    return HttpResponse.json({ data: [{id: 'model1'}] });
                })
            );
            await fetchProviderModels('http://api.example.com/models', 'key');
            expect(fetchedUrl).toBe('http://api.example.com/models');
        });

        it('should NOT append /models to url if it ends with /models/', async () => {
            let fetchedUrl = '';
            server.use(
                http.get('http://api.example.com/models/', ({ request }) => {
                    fetchedUrl = request.url;
                    return HttpResponse.json({ data: [{id: 'model1'}] });
                })
            );
            await fetchProviderModels('http://api.example.com/models/', 'key');
            expect(fetchedUrl).toBe('http://api.example.com/models/');
        });
    });

    describe('updateModelSelectUI else branch', () => {
        it('should set modelSelect.value if input value exists in options', () => {
            const modelSelect = screen.getByTestId('model-select');
            const modelInput = screen.getByTestId('model-input');
            const statusDiv = screen.getByTestId('fetch-status');

            modelInput.value = 'model1';

            updateModelSelectUI([{id: 'model1'}, {id: 'model2'}], modelSelect, modelInput, statusDiv);

            expect(modelSelect.value).toBe('model1');
        });
    });
});
