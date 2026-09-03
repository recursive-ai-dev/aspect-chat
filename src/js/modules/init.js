import { fetchModelsIfPossible, populateProviderSelect } from './settings.js';
import { loadDefaultAspects } from './aspects.js';
import { updateModelBadge } from './ui.js';
import { state } from './state.js';
import { WEBLLM_PROVIDER } from './providers.js';
import { marked } from 'marked';

const el = (id) => document.getElementById(id);

function setValue(id, value) {
    const node = el(id);
    if (node) node.value = value;
}

/** Restore the saved theme before the first paint of any view. */
function applyTheme() {
    let isDarkMode = false;
    try {
        isDarkMode = localStorage.getItem('darkMode') === 'true';
    } catch { /* storage unavailable — fall back to light */ }

    const toggle = el('dark-mode-toggle');
    if (toggle) toggle.checked = isDarkMode;
    document.body.classList.toggle('dark-theme', isDarkMode);
}

/** Grow the composer with its content, up to a sensible ceiling. */
function wireAutoResize() {
    const chatInput = el('chat-input');
    if (!chatInput) return;

    const resize = () => {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 200) + 'px';
    };
    chatInput.addEventListener('input', resize);
    resize();
}

export async function init() {
    populateProviderSelect('api-provider-select', false);
    populateProviderSelect('fallback-provider-select', true);

    const s = state.settings;
    setValue('api-url-input', s.apiUrl);
    setValue('api-key-input', s.apiKey);
    setValue('api-model-input', s.model);
    setValue('api-max-context-input', s.maxContext);
    setValue('tool-timeout-input', Math.round((s.toolTimeoutMs || 30000) / 1000));
    setValue('max-knowledge-chars-input', s.maxKnowledgeChars || 100000);
    setValue('fallback-url-input', s.fallbackUrl);
    setValue('fallback-key-input', s.fallbackKey);
    setValue('fallback-model-input', s.fallbackModel);

    const rememberToggle = el('remember-key-toggle');
    if (rememberToggle) rememberToggle.checked = s.rememberKey !== false;

    const providerSelect = el('api-provider-select');
    if (providerSelect) providerSelect.value = s.provider || 'custom';

    const fallbackSelect = el('fallback-provider-select');
    if (fallbackSelect) fallbackSelect.value = s.fallbackProvider || '';

    applyTheme();

    marked.setOptions({
        breaks: true,
        gfm: true
    });

    // Load the library first so the app is usable immediately; probing the
    // provider for its model list is a background nicety, not a dependency.
    await loadDefaultAspects();

    updateModelBadge();
    wireAutoResize();

    if (s.provider && s.provider !== 'custom' && s.provider !== WEBLLM_PROVIDER) {
        fetchModelsIfPossible().catch(err => {
            console.warn('Could not pre-fetch the model list', err.message);
        });
    }
}
