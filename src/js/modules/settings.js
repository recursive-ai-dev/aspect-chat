import { cancelCreateAspect } from './aspects.js';
import { state } from './state.js';
import {
    PROVIDERS,
    WEBLLM_PROVIDER,
    getProvider,
    requiresApiKey,
    isLocalEndpoint,
    fetchProviderModels,
    testConnection,
    mixedContentWarning
} from './providers.js';
import { getWebLLMModels, isWebGPUAvailable } from './webllm.js';
import { applyTheme, populateThemeSelect, DEFAULT_THEME, THEMES } from './themes.js';

export { fetchProviderModels };

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const el = (id) => document.getElementById(id);

function setStatus(node, message, kind = 'info') {
    if (!node) return;
    node.innerText = message;
    node.style.color = kind === 'error' ? 'var(--danger-text)'
        : kind === 'success' ? 'var(--accent-primary)'
        : 'var(--text-light)';
}

/**
 * localStorage throws in private-browsing modes and when the quota is full.
 * Settings are small, but a throw here would abort the whole save, so every
 * write is guarded and reported once rather than crashing the handler.
 */
function safeSet(key, value) {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch (err) {
        console.warn(`Could not persist setting "${key}"`, err.message);
        return false;
    }
}

function safeRemove(key) {
    try {
        localStorage.removeItem(key);
    } catch { /* nothing to do */ }
}

/** Fill a <select> with the provider catalogue. */
export function populateProviderSelect(selectId, includeNone) {
    const select = el(selectId);
    if (!select) return;

    select.innerHTML = '';
    if (includeNone) {
        const none = document.createElement('option');
        none.value = '';
        none.innerText = 'None';
        select.appendChild(none);
    }

    PROVIDERS.forEach(provider => {
        // A cloud endpoint makes a poor fallback for the fallback slot's main
        // purpose (staying usable when the network is gone), but users may
        // still want one, so only "Custom" is filtered out where a bare URL
        // field already covers it.
        const option = document.createElement('option');
        option.value = provider.id;
        option.innerText = provider.label;
        select.appendChild(option);
    });
}

/* ------------------------------------------------------------------ *
 * Modal
 * ------------------------------------------------------------------ */

export function openSettings() {
    const modal = el('settings-modal');
    if (!modal) return;

    populateProviderSelect('api-provider-select', false);
    populateProviderSelect('fallback-provider-select', true);

    const providerSelect = el('api-provider-select');
    if (providerSelect) providerSelect.value = state.settings.provider || 'custom';

    if (el('api-url-input')) el('api-url-input').value = state.settings.apiUrl || '';
    if (el('api-key-input')) el('api-key-input').value = state.settings.apiKey || '';
    if (el('api-model-input')) el('api-model-input').value = state.settings.model || '';
    if (el('api-max-context-input')) el('api-max-context-input').value = state.settings.maxContext;
    if (el('remember-key-toggle')) el('remember-key-toggle').checked = state.settings.rememberKey !== false;
    if (el('tool-timeout-input')) el('tool-timeout-input').value = Math.round((state.settings.toolTimeoutMs || 30000) / 1000);
    if (el('max-knowledge-chars-input')) el('max-knowledge-chars-input').value = state.settings.maxKnowledgeChars || 100000;

    const fallbackSelect = el('fallback-provider-select');
    if (fallbackSelect) fallbackSelect.value = state.settings.fallbackProvider || '';
    if (el('fallback-url-input')) el('fallback-url-input').value = state.settings.fallbackUrl || '';
    if (el('fallback-key-input')) el('fallback-key-input').value = state.settings.fallbackKey || '';
    if (el('fallback-model-input')) el('fallback-model-input').value = state.settings.fallbackModel || '';

    populateThemeSelect(el('theme-select'), state.settings.theme);

    applyProviderHints();
    applyFallbackVisibility();

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
}

export function closeSettings() {
    const modal = el('settings-modal');
    if (modal) modal.classList.add('hidden');
}

export function saveSettings() {
    const s = state.settings;

    s.apiUrl = el('api-url-input') ? el('api-url-input').value.trim() : s.apiUrl;
    s.apiKey = el('api-key-input') ? el('api-key-input').value.trim() : s.apiKey;
    s.model = el('api-model-input') ? el('api-model-input').value.trim() : s.model;
    s.maxContext = parseInt(el('api-max-context-input')?.value, 10) || 20;
    s.rememberKey = el('remember-key-toggle') ? el('remember-key-toggle').checked : true;

    const timeoutSeconds = parseInt(el('tool-timeout-input')?.value, 10);
    s.toolTimeoutMs = Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
        ? timeoutSeconds * 1000
        : 30000;

    const maxKnowledge = parseInt(el('max-knowledge-chars-input')?.value, 10);
    s.maxKnowledgeChars = Number.isFinite(maxKnowledge) && maxKnowledge > 0
        ? maxKnowledge
        : 100000;

    const providerSelect = el('api-provider-select');
    if (providerSelect) {
        s.provider = providerSelect.value;
        safeSet('provider', s.provider);
    }

    s.fallbackProvider = el('fallback-provider-select') ? el('fallback-provider-select').value : '';
    s.fallbackUrl = el('fallback-url-input') ? el('fallback-url-input').value.trim() : '';
    s.fallbackKey = el('fallback-key-input') ? el('fallback-key-input').value.trim() : '';
    s.fallbackModel = el('fallback-model-input') ? el('fallback-model-input').value.trim() : '';

    safeSet('apiUrl', s.apiUrl);
    safeSet('model', s.model);
    safeSet('maxContext', String(s.maxContext));
    safeSet('toolTimeoutMs', String(s.toolTimeoutMs));
    safeSet('maxKnowledgeChars', String(s.maxKnowledgeChars));
    safeSet('rememberKey', String(s.rememberKey));
    safeSet('fallbackProvider', s.fallbackProvider);
    safeSet('fallbackUrl', s.fallbackUrl);
    safeSet('fallbackModel', s.fallbackModel);

    // API keys. Persisting these is opt-out rather than opt-in: an app you
    // reload all day is unusable if it forgets your credentials every time.
    // Local providers need no key at all, so this only ever affects hosted ones.
    if (s.rememberKey) {
        safeSet('apiKey', s.apiKey);
        safeSet('fallbackKey', s.fallbackKey);
        try { sessionStorage.removeItem('apiKey'); } catch { /* ignore */ }
    } else {
        safeRemove('apiKey');
        safeRemove('fallbackKey');
        // Keep it for this tab so the user is not locked out mid-session.
        try {
            if (s.apiKey) sessionStorage.setItem('apiKey', s.apiKey);
            else sessionStorage.removeItem('apiKey');
        } catch { /* ignore */ }
    }

    const themeSelect = el('theme-select');
    if (themeSelect && themeSelect.value) {
        s.theme = THEMES.some(t => t.id === themeSelect.value) ? themeSelect.value : DEFAULT_THEME;
    } else if (!s.theme) {
        s.theme = DEFAULT_THEME;
    }
    safeSet('theme', s.theme);
    // Keep the legacy flag roughly in sync for any older code path.
    safeSet('darkMode', String(!!(THEMES.find(t => t.id === s.theme) || {}).dark));
    applyTheme(s.theme);

    if (typeof window.updateModelBadge === 'function') window.updateModelBadge();
    if (typeof window.showToast === 'function') window.showToast('Settings saved.');

    closeSettings();
}

/* ------------------------------------------------------------------ *
 * Provider selection
 * ------------------------------------------------------------------ */

/** Show the provider's setup hint and grey out fields it does not use. */
export function applyProviderHints() {
    const providerSelect = el('api-provider-select');
    const hintNode = el('provider-hint');
    const urlField = el('api-url-field');
    const keyField = el('api-key-field');
    if (!providerSelect) return;

    const provider = getProvider(providerSelect.value);
    const isWebLLM = providerSelect.value === WEBLLM_PROVIDER;
    const url = el('api-url-input') ? el('api-url-input').value.trim() : '';

    if (urlField) urlField.classList.toggle('hidden', isWebLLM);
    if (keyField) keyField.classList.toggle('hidden', isWebLLM || (!!url && !requiresApiKey(url)));

    if (!hintNode) return;

    const messages = [];
    if (isWebLLM && !isWebGPUAvailable()) {
        messages.push('This browser does not expose WebGPU, so WebLLM cannot run here. Use a recent Chrome/Edge, or point Aspect Studio at a local server instead.');
    } else if (provider && provider.hint) {
        messages.push(provider.hint);
    }
    if (url && !requiresApiKey(url) && !isWebLLM) {
        messages.push('Local endpoint detected — no API key required.');
    }
    const mixed = mixedContentWarning(url);
    if (mixed) messages.push(mixed);

    hintNode.innerText = messages.join(' ');
    hintNode.classList.toggle('hidden', messages.length === 0);
}

export function onProviderSelect() {
    const providerSelect = el('api-provider-select');
    const urlInput = el('api-url-input');
    if (!providerSelect || !urlInput) return;

    const provider = getProvider(providerSelect.value);
    if (providerSelect.value === WEBLLM_PROVIDER) {
        // WebLLM has no URL; the model list comes from the bundled catalogue.
        loadWebLLMModelOptions('api-model-select', 'api-model-input', 'model-fetch-status');
    } else if (provider && provider.url) {
        urlInput.value = provider.url;
    } else if (providerSelect.value !== 'custom') {
        urlInput.value = providerSelect.value;
    }

    applyProviderHints();
    if (providerSelect.value !== WEBLLM_PROVIDER) {
        fetchModelsIfPossible();
    }
}

export function onFallbackProviderSelect() {
    applyFallbackVisibility();

    const select = el('fallback-provider-select');
    if (!select) return;

    const provider = getProvider(select.value);
    const urlInput = el('fallback-url-input');
    if (urlInput && provider && provider.url) {
        urlInput.value = provider.url;
    }

    if (select.value === WEBLLM_PROVIDER) {
        loadWebLLMModelOptions('fallback-model-select', 'fallback-model-input', 'fallback-model-fetch-status');
    } else if (select.value) {
        fetchFallbackModels();
    }
}

/** Show only the fallback fields the chosen fallback provider actually needs. */
export function applyFallbackVisibility() {
    const select = el('fallback-provider-select');
    if (!select) return;

    const value = select.value;
    const isWebLLM = value === WEBLLM_PROVIDER;
    const isNone = !value;

    document.querySelectorAll('.fallback-field').forEach(node => {
        node.classList.toggle('hidden', isNone);
    });
    document.querySelectorAll('.fallback-http-field').forEach(node => {
        node.classList.toggle('hidden', isNone || isWebLLM);
    });

    const modelSelect = el('fallback-model-select');
    if (modelSelect && isNone) modelSelect.classList.add('hidden');
}

export function onModelSelectDropdown() {
    const select = el('api-model-select');
    const input = el('api-model-input');
    if (select && input) input.value = select.value;
    if (typeof window.updateModelBadge === 'function') window.updateModelBadge();
}

export function onFallbackModelSelectDropdown() {
    const select = el('fallback-model-select');
    const input = el('fallback-model-input');
    if (select && input) input.value = select.value;
}

/* ------------------------------------------------------------------ *
 * Model lists
 * ------------------------------------------------------------------ */

export function updateModelSelectUI(models, modelSelect, modelInput, statusDiv) {
    modelSelect.innerHTML = '';
    // fetchProviderModels normalises to strings, but accept the raw
    // OpenAI `{ id }` objects too so any direct caller behaves the same.
    models.forEach(model => {
        const id = typeof model === 'string' ? model : (model.id || model.name || model.model);
        if (!id) return;
        const opt = document.createElement('option');
        opt.value = id;
        opt.innerText = id;
        modelSelect.appendChild(opt);
    });

    if (Array.from(modelSelect.options).some(o => o.value === modelInput.value)) {
        modelSelect.value = modelInput.value;
    } else {
        modelInput.value = modelSelect.value;
    }

    modelInput.classList.add('hidden');
    modelSelect.classList.remove('hidden');
    setStatus(statusDiv, `${models.length} model${models.length === 1 ? '' : 's'} available.`, 'success');
}

async function loadWebLLMModelOptions(selectId, inputId, statusId) {
    const select = el(selectId);
    const input = el(inputId);
    const status = el(statusId);
    if (!select || !input) return;

    setStatus(status, 'Loading the in-browser model catalogue…');
    try {
        const models = await getWebLLMModels();
        updateModelSelectUI(models, select, input, status);
        setStatus(status, `${models.length} in-browser models available. The first run downloads the weights (typically 1–4 GB) and caches them.`, 'success');
    } catch (err) {
        setStatus(status, `Could not load the WebLLM model list: ${err.message}`, 'error');
    }
}

/**
 * Fetch the primary provider's model list when there is enough information
 * to do so. Called on every keystroke in the URL and key fields, so it stays
 * quiet rather than reporting errors for a half-typed URL.
 */
export async function fetchModelsIfPossible() {
    const url = el('api-url-input') ? el('api-url-input').value.trim() : '';
    const key = el('api-key-input') ? el('api-key-input').value.trim() : '';
    const statusDiv = el('model-fetch-status');
    const modelInput = el('api-model-input');
    const modelSelect = el('api-model-select');
    const providerSelect = el('api-provider-select');
    if (!modelInput || !modelSelect || !providerSelect) return;

    applyProviderHints();

    if (providerSelect.value === WEBLLM_PROVIDER) return;
    if (!url) return;

    modelInput.classList.remove('hidden');
    modelSelect.classList.add('hidden');
    setStatus(statusDiv, '');

    if (providerSelect.value === 'custom') {
        return;
    }

    // Local servers list their models without credentials; hosted ones do not.
    if (requiresApiKey(url) && !key) {
        setStatus(statusDiv, 'Enter an API key to fetch the available models.');
        return;
    }

    setStatus(statusDiv, 'Fetching models…');
    try {
        const models = await fetchProviderModels(url, key);
        updateModelSelectUI(models, modelSelect, modelInput, statusDiv);
    } catch (err) {
        setStatus(statusDiv, err.message, 'error');
    }
}

export async function fetchFallbackModels() {
    const select = el('fallback-provider-select');
    if (!select || !select.value || select.value === WEBLLM_PROVIDER) return;

    const url = el('fallback-url-input') ? el('fallback-url-input').value.trim() : '';
    const key = el('fallback-key-input') ? el('fallback-key-input').value.trim() : '';
    const status = el('fallback-model-fetch-status');
    const modelInput = el('fallback-model-input');
    const modelSelect = el('fallback-model-select');
    if (!url || !modelInput || !modelSelect) return;

    if (requiresApiKey(url) && !key) {
        setStatus(status, 'Enter an API key to fetch the available models.');
        return;
    }

    setStatus(status, 'Fetching models…');
    try {
        const models = await fetchProviderModels(url, key);
        updateModelSelectUI(models, modelSelect, modelInput, status);
    } catch (err) {
        setStatus(status, err.message, 'error');
    }
}

/* ------------------------------------------------------------------ *
 * Connection test
 * ------------------------------------------------------------------ */

/**
 * Probe the configured endpoint and report the result in the settings modal.
 *
 * This is the single most useful thing when a local model will not connect:
 * it separates "server is not running" from "server is running but blocked
 * the browser", which the chat view alone cannot tell you.
 */
export async function testPrimaryConnection() {
    const button = el('test-connection-btn');
    const status = el('model-fetch-status');
    const providerSelect = el('api-provider-select');

    if (providerSelect && providerSelect.value === WEBLLM_PROVIDER) {
        if (!isWebGPUAvailable()) {
            setStatus(status, 'WebGPU is not available in this browser, so WebLLM cannot run here.', 'error');
        } else {
            setStatus(status, 'WebGPU is available. The selected model downloads on first use.', 'success');
        }
        return;
    }

    const url = el('api-url-input') ? el('api-url-input').value.trim() : '';
    const key = el('api-key-input') ? el('api-key-input').value.trim() : '';

    if (button) {
        button.disabled = true;
        button.innerText = 'Testing…';
    }
    setStatus(status, 'Contacting the endpoint…');

    try {
        const result = await testConnection(url, key);
        setStatus(status, result.message, result.ok ? 'success' : 'error');

        if (result.ok && result.models && result.models.length) {
            const modelInput = el('api-model-input');
            const modelSelect = el('api-model-select');
            if (modelInput && modelSelect) {
                updateModelSelectUI(result.models, modelSelect, modelInput, status);
                setStatus(status, result.message, 'success');
            }
        }
    } finally {
        if (button) {
            button.disabled = false;
            button.innerText = 'Test connection';
        }
    }
}

export async function testFallbackConnection() {
    const select = el('fallback-provider-select');
    const status = el('fallback-model-fetch-status');
    if (!select || !select.value) {
        setStatus(status, 'No fallback provider selected.');
        return;
    }

    if (select.value === WEBLLM_PROVIDER) {
        setStatus(
            status,
            isWebGPUAvailable()
                ? 'WebGPU is available. The selected model downloads on first use.'
                : 'WebGPU is not available in this browser, so WebLLM cannot run here.',
            isWebGPUAvailable() ? 'success' : 'error'
        );
        return;
    }

    const url = el('fallback-url-input') ? el('fallback-url-input').value.trim() : '';
    const key = el('fallback-key-input') ? el('fallback-key-input').value.trim() : '';
    setStatus(status, 'Contacting the endpoint…');
    const result = await testConnection(url, key);
    setStatus(status, result.message, result.ok ? 'success' : 'error');
}

/* ------------------------------------------------------------------ *
 * Modal dismissal
 * ------------------------------------------------------------------ */

window.addEventListener('click', function (event) {
    const createModal = el('create-aspect-modal');
    if (createModal && event.target === createModal) {
        cancelCreateAspect();
    }
    const settingsModal = el('settings-modal');
    if (settingsModal && event.target === settingsModal) {
        settingsModal.classList.add('hidden');
    }
});

window.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;

    // Close the topmost open modal only, so Escape inside the tool editor does
    // not also dismiss whatever is behind it.
    const layers = [
        { id: 'tool-editor-modal', close: () => el('tool-editor-modal').classList.add('hidden') },
        { id: 'workflow-modal', close: () => el('workflow-modal').classList.add('hidden') },
        { id: 'system-tools-modal', close: () => el('system-tools-modal').classList.add('hidden') },
        { id: 'settings-modal', close: () => el('settings-modal').classList.add('hidden') },
        { id: 'create-aspect-modal', close: () => cancelCreateAspect() }
    ];

    for (const layer of layers) {
        const node = el(layer.id);
        if (node && !node.classList.contains('hidden')) {
            layer.close();
            return;
        }
    }
});

export { isLocalEndpoint, requiresApiKey };
