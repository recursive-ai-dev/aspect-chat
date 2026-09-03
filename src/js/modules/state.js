import { scheduleSave, flushSave } from './persist.js';

/** Generation defaults applied when an Aspect does not override them. */
export const DEFAULT_PARAMS = {
    temperature: 0.7,
    maxTokens: 0,   // 0 = let the server decide
    topP: 1
};

function readStoredKey() {
    if (typeof localStorage === 'undefined') return '';
    // Prefer the durable copy; fall back to a session-scoped one so a user who
    // turned "remember" off mid-session is not logged out of their own tab.
    return localStorage.getItem('apiKey') || sessionStorage.getItem('apiKey') || '';
}

function readBool(key, fallback) {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === 'true';
}

function readNumber(key, fallback) {
    if (typeof localStorage === 'undefined') return fallback;
    const value = parseFloat(localStorage.getItem(key));
    return Number.isFinite(value) ? value : fallback;
}

export let state = {
    settings: {
        apiUrl: (typeof localStorage !== 'undefined' && localStorage.getItem('apiUrl')) || '',
        apiKey: readStoredKey(),
        model: (typeof localStorage !== 'undefined' && localStorage.getItem('model')) || '',
        provider: (typeof localStorage !== 'undefined' && localStorage.getItem('provider')) || 'custom',
        maxContext: readNumber('maxContext', 20),
        rememberKey: readBool('rememberKey', true),

        // Optional secondary provider, used when the primary one fails.
        fallbackProvider: (typeof localStorage !== 'undefined' && localStorage.getItem('fallbackProvider')) || '',
        fallbackUrl: (typeof localStorage !== 'undefined' && localStorage.getItem('fallbackUrl')) || '',
        fallbackKey: (typeof localStorage !== 'undefined' && localStorage.getItem('fallbackKey')) || '',
        fallbackModel: (typeof localStorage !== 'undefined' && localStorage.getItem('fallbackModel')) || '',

        toolTimeoutMs: readNumber('toolTimeoutMs', 30000)
    },
    aspects: [],
    currentAspectId: null,
    hasUnsavedChanges: false,
    saveReminderDismissed: false,
    consecutiveToolRuns: 0,
    abortController: null,
    isGenerating: false
};

/** Resolve the generation parameters for an Aspect, filling in defaults. */
export function getGenerationParams(aspect) {
    const params = (aspect && aspect.params) || {};
    return {
        temperature: Number.isFinite(params.temperature) ? params.temperature : DEFAULT_PARAMS.temperature,
        maxTokens: Number.isFinite(params.maxTokens) ? params.maxTokens : DEFAULT_PARAMS.maxTokens,
        topP: Number.isFinite(params.topP) ? params.topP : DEFAULT_PARAMS.topP
    };
}

/**
 * Queue a write of the Aspect library to IndexedDB.
 * Debounced, so calling it on every keystroke is cheap.
 */
export function persistAspects() {
    return scheduleSave(state.aspects);
}

/** Write any queued changes right now. */
export function flushAspects() {
    return flushSave();
}

export function markChangesSaved() {
    state.hasUnsavedChanges = false;
    const reminder = document.getElementById('save-reminder');
    if (reminder) reminder.classList.add('hidden');
    const saveBtn = document.getElementById('sidebar-save-btn');
    if (saveBtn) saveBtn.classList.remove('pulsate');
    persistAspects();
}
