import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { state } from '../src/js/modules/state.js';
import { fetchModelsIfPossible, onProviderSelect } from '../src/js/modules/settings.js';

describe('API Interactions', () => {
    beforeEach(() => {
        state.settings.apiUrl = 'https://api.openai.com/v1';
        state.settings.apiKey = 'fake-key';
        
        // Mock DOM UI updates
        document.body.innerHTML = `
            <input id="api-url-input" value="https://api.openai.com/v1" />
            <input id="api-key-input" value="fake-key" />
            <div id="model-fetch-status"></div>
            <select id="api-provider-select">
                <option value="custom">Custom</option>
                <option value="openai">OpenAI</option>
            </select>
            <select id="api-model-select"></select>
            <input id="api-model-input" type="text" />
            <button id="save-btn"></button>
        `;
        document.getElementById('api-provider-select').value = 'openai';
    });

    it('should successfully fetch models and update DOM', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ data: [{ id: 'gpt-4o' }, { id: 'gpt-3.5-turbo' }] })
        });

        await fetchModelsIfPossible();

        const select = document.getElementById('api-model-select');
        expect(select.classList.contains('hidden')).toBe(false);
        expect(select.children.length).toBe(2);
        expect(select.children[0].value).toBe('gpt-4o');
    });

    it('should fallback gracefully on API error', async () => {
        global.fetch = vi.fn().mockRejectedValue(new Error("Network Error"));

        await fetchModelsIfPossible();

        const select = document.getElementById('api-model-select');
        expect(select.classList.contains('hidden')).toBe(true);
        expect(document.getElementById('api-model-input').classList.contains('hidden')).toBe(false);
    });
});

describe('onProviderSelect', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <input id="api-url-input" value="original-url" />
            <select id="api-provider-select">
                <option value="custom">Custom</option>
                <option value="https://api.openai.com/v1">OpenAI</option>
            </select>
            <input id="api-key-input" value="fake-key" />
            <div id="model-fetch-status"></div>
            <select id="api-model-select"></select>
            <input id="api-model-input" type="text" />
        `;
        // Mock fetchModelsIfPossible as it gets called inside onProviderSelect
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ data: [] })
        });
    });

    it('should update urlInput value if provider is not custom', () => {
        const providerSelect = document.getElementById('api-provider-select');
        const urlInput = document.getElementById('api-url-input');

        providerSelect.value = 'https://api.openai.com/v1';

        onProviderSelect();

        expect(urlInput.value).toBe('https://api.openai.com/v1');
    });

    it('should not update urlInput value if provider is custom', () => {
        const providerSelect = document.getElementById('api-provider-select');
        const urlInput = document.getElementById('api-url-input');

        providerSelect.value = 'custom';

        onProviderSelect();

        expect(urlInput.value).toBe('original-url');
    });
});
