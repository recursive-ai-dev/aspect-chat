import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import { http, HttpResponse } from 'msw';
import { server } from './mocks/server.js';
import { state } from '../src/js/modules/state.js';
import { fetchModelsIfPossible, onProviderSelect } from '../src/js/modules/settings.js';

describe('API Interactions', () => {
    beforeEach(() => {
        state.settings.apiUrl = 'https://api.openai.com/v1';
        state.settings.apiKey = 'fake-key';
        
        document.body.innerHTML = `
            <input id="api-url-input" value="https://api.openai.com/v1" />
            <input id="api-key-input" value="fake-key" />
            <div id="model-fetch-status"></div>
            <select id="api-provider-select">
                <option value="custom">Custom</option>
                <option value="openai">OpenAI</option>
            </select>
            <select id="api-model-select" data-testid="model-select"></select>
            <input id="api-model-input" type="text" data-testid="model-input" />
            <button id="save-btn"></button>
        `;
        document.getElementById('api-provider-select').value = 'openai';
    });
    
    afterEach(() => {
        server.resetHandlers();
    });

    it('should successfully fetch models and update DOM', async () => {
        server.use(
            http.get('https://api.openai.com/v1/models', () => {
                return HttpResponse.json({ data: [{ id: 'gpt-4o' }, { id: 'gpt-3.5-turbo' }] });
            })
        );

        await fetchModelsIfPossible();

        const select = screen.getByTestId('model-select');
        expect(select).not.toHaveClass('hidden');
        expect(select.children.length).toBe(2);
        expect(select.children[0].value).toBe('gpt-4o');
    });

    it('should fallback gracefully on API error', async () => {
        server.use(
            http.get('https://api.openai.com/v1/models', () => {
                return HttpResponse.error();
            })
        );

        await fetchModelsIfPossible();

        const select = screen.getByTestId('model-select');
        const input = screen.getByTestId('model-input');
        expect(select).toHaveClass('hidden');
        expect(input).not.toHaveClass('hidden');
    });
});

describe('onProviderSelect', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <input id="api-url-input" value="original-url" data-testid="url-input" />
            <select id="api-provider-select" data-testid="provider-select">
                <option value="custom">Custom</option>
                <option value="https://api.openai.com/v1">OpenAI</option>
            </select>
            <input id="api-key-input" value="fake-key" />
            <div id="model-fetch-status"></div>
            <select id="api-model-select"></select>
            <input id="api-model-input" type="text" />
        `;
    });
    
    afterEach(() => {
        server.resetHandlers();
    });

    it('should update urlInput value if provider is not custom', () => {
        const providerSelect = screen.getByTestId('provider-select');
        const urlInput = screen.getByTestId('url-input');

        providerSelect.value = 'https://api.openai.com/v1';

        onProviderSelect();

        expect(urlInput).toHaveValue('https://api.openai.com/v1');
    });

    it('should not update urlInput value if provider is custom', () => {
        const providerSelect = screen.getByTestId('provider-select');
        const urlInput = screen.getByTestId('url-input');

        providerSelect.value = 'custom';

        onProviderSelect();

        expect(urlInput).toHaveValue('original-url');
    });
});
