/**
 * Application entry point.
 *
 * Wiring is done here with event delegation on `data-action` attributes rather
 * than inline `onclick=` handlers in the HTML. The old approach required every
 * handler to be published on `window` and silently broke whenever a name was
 * missing — which is exactly how the settings modal ended up with a Fallback
 * Provider section calling functions that did not exist.
 */

import './modules/workflowBuilder.js';

import { state, flushAspects, persistAspects } from './modules/state.js';
import { init } from './modules/init.js';
import { initToolEditor, openToolEditor, closeToolEditor, saveToolCode } from './modules/toolEditor.js';

import {
    loadDefaultAspects,
    createNewAspect,
    acceptCreateAspect,
    acceptCreateAspectFromTemplate,
    cancelCreateAspect,
    selectAspect,
    getCurrentAspect,
    updateAspectData,
    deleteCurrentAspect,
    renderAspectList,
    uploadCreateIcon,
    getGenericIcon,
    getLakesideSageIcon,
    normalizeAspect,
    trustAspectTools
} from './modules/aspects.js';

import {
    exportAllAspects,
    importAllAspects,
    getSnapshots,
    restoreSnapshot
} from './modules/backup.js';

import {
    showEditorView,
    showChatView,
    uploadIcon,
    uploadTools,
    uploadBackground,
    applyAspectBackground,
    renderPresetBgGrid,
    selectPresetBackground,
    openSystemToolsModal,
    markChangesUnsaved,
    dismissSaveReminder,
    toggleAdvancedMode,
    updateBasicInstructions,
    updateGenerationParam,
    updateModelBadge,
    newConversation,
    renderConversationList,
    renderKnowledgeFileList,
    generateAspectIcon,
    showToast
} from './modules/ui.js';

import { applyTheme } from './modules/themes.js';

import {
    openSettings,
    saveSettings,
    onProviderSelect,
    onModelSelectDropdown,
    onFallbackProviderSelect,
    onFallbackModelSelectDropdown,
    fetchModelsIfPossible,
    fetchFallbackModels,
    testPrimaryConnection,
    testFallbackConnection
} from './modules/settings.js';

import {
    sendMessage,
    sendAIRequest,
    abortAIRequest,
    insertToolTag,
    addSystemLog,
    updateSystemLog,
    executeJavaScriptTool,
    processAIResponseAndTools
} from './modules/tools.js';

import {
    renderChatMessages,
    escapeHtml,
    editMessage,
    deleteMessage,
    regenerateMessage,
    copyMessage,
    toggleToolsDropdown
} from './modules/chat.js';

import { saveAspectToFile, exportAspectToWebpage, loadAspectFile } from './modules/zip.js';
import { saveKnowledgeFile, getKnowledgeFilesText, uploadKnowledgeFiles } from './modules/db.js';

/* ------------------------------------------------------------------ *
 * Globals
 *
 * Kept for the workflow builder, the tool editor and anyone poking at the
 * app from the console. The UI itself no longer depends on them.
 * ------------------------------------------------------------------ */

Object.assign(window, {
    state,
    getCurrentAspect,
    getGenericIcon,
    getLakesideSageIcon,
    normalizeAspect,
    selectAspect,
    updateAspectData,
    renderAspectList,
    renderChatMessages,
    renderConversationList,
    renderKnowledgeFileList,
    updateModelBadge,
    escapeHtml,
    editMessage,
    deleteMessage,
    regenerateMessage,
    copyMessage,
    insertToolTag,
    addSystemLog,
    updateSystemLog,
    markChangesUnsaved,
    showEditorView,
    showChatView,
    executeJavaScriptTool,
    processAIResponseAndTools,
    sendAIRequest,
    sendMessage,
    saveAspectToFile,
    exportAspectToWebpage,
    loadAspectFile,
    saveKnowledgeFile,
    getKnowledgeFilesText,
    openSettings,
    saveSettings,
    openToolEditor,
    closeToolEditor,
    saveToolCode,
    openSystemToolsModal,
    showToast,
    acceptCreateAspect,
    acceptCreateAspectFromTemplate,
    uploadCreateIcon,
    cancelCreateAspect
});

/* ------------------------------------------------------------------ *
 * Declarative wiring
 * ------------------------------------------------------------------ */

const click = (id) => document.getElementById(id)?.click();

/** Click handlers, keyed by the element's `data-action` value. */
const ACTIONS = {
    'open-settings': () => { openSettings(); renderSnapshotList(); },
    'save-settings': saveSettings,
    'close-settings': () => document.getElementById('settings-modal').classList.add('hidden'),
    'test-connection': testPrimaryConnection,
    'test-fallback': testFallbackConnection,
    'refresh-models': fetchModelsIfPossible,

    'upload-aspect': () => click('upload-aspect-input'),
    'save-aspect': saveAspectToFile,
    'dismiss-save-reminder': dismissSaveReminder,
    'export-webpage': exportAspectToWebpage,
    'delete-aspect': deleteCurrentAspect,

    'show-editor': showEditorView,
    'show-chat': showChatView,

    'upload-icon': () => click('upload-icon-input'),
    'upload-background': () => click('upload-bg-input'),
    'upload-knowledge': () => click('upload-knowledge-input'),
    'upload-tools': () => click('upload-tools-input'),

    'open-system-tools': openSystemToolsModal,
    'close-system-tools': () => document.getElementById('system-tools-modal').classList.add('hidden'),
    'new-tool': () => openToolEditor(),
    'close-tool-editor': closeToolEditor,
    'save-tool': saveToolCode,

    'open-workflow': () => window.openWorkflowModal(),
    'close-workflow': () => window.closeWorkflowModal(),
    'save-workflow': () => window.saveWorkflowAsTool(),

    'cancel-create': cancelCreateAspect,
    'new-conversation': newConversation,

    'send': sendMessage,
    'stop': abortAIRequest,

    'trust-tools': trustAspectTools,
    'generate-icon': generateAspectIcon,

    // Storage-error overlay
    'storage-retry': () => location.reload(),
    'storage-fresh': () => window.storageStartFresh(),

    // Backup & restore
    'export-all': exportAllAspects,
    'import-all': () => click('import-all-input')
};

function wireDelegatedClicks() {
    document.addEventListener('click', (event) => {
        const trigger = event.target.closest('[data-action]');
        if (trigger) {
            const handler = ACTIONS[trigger.dataset.action];
            if (handler) {
                event.preventDefault();
                Promise.resolve(handler()).catch(err => {
                    console.error(`Action "${trigger.dataset.action}" failed`, err);
                    showToast(err.message || 'Something went wrong.', 'error');
                });
            }
            return;
        }

        const nodeButton = event.target.closest('[data-workflow-node]');
        if (nodeButton) {
            window.addWorkflowNode(nodeButton.dataset.workflowNode);
        }
    });
}

/** Bind a listener only when the element exists, so partial DOMs stay safe. */
function on(id, eventName, handler) {
    const node = document.getElementById(id);
    if (node) node.addEventListener(eventName, handler);
}

/** Populate the Settings > Backup snapshot list with restore buttons. */
async function renderSnapshotList() {
    const list = document.getElementById('snapshot-list');
    if (!list) return;
    list.innerHTML = '<div class="snapshot-empty">Loading snapshots…</div>';
    let snapshots = [];
    try {
        snapshots = await getSnapshots();
    } catch { /* handled below */ }

    list.innerHTML = '';
    if (!snapshots.length) {
        list.innerHTML = '<div class="snapshot-empty">No automatic snapshots yet.</div>';
        return;
    }
    snapshots.forEach(s => {
        const row = document.createElement('div');
        row.className = 'snapshot-row';

        const label = document.createElement('span');
        label.className = 'snapshot-label';
        label.textContent = `${new Date(s.createdAt).toLocaleString()} · ${s.aspectCount} Aspect(s) · ${s.label}`;

        const btn = document.createElement('button');
        btn.className = 'settings-btn';
        btn.textContent = 'Restore';
        btn.onclick = async () => {
            if (!window.confirm('Replace your current library with this snapshot? A snapshot of the current state is saved first, so this is reversible.')) return;
            await restoreSnapshot(s.id);
            renderSnapshotList();
        };

        row.appendChild(label);
        row.appendChild(btn);
        list.appendChild(row);
    });
}

function wireInputs() {
    // --- Settings
    on('api-provider-select', 'change', onProviderSelect);
    on('api-url-input', 'input', fetchModelsIfPossible);
    on('api-key-input', 'input', fetchModelsIfPossible);
    on('api-model-select', 'change', onModelSelectDropdown);
    on('api-model-input', 'input', updateModelBadge);
    on('fallback-provider-select', 'change', onFallbackProviderSelect);
    on('fallback-url-input', 'input', fetchFallbackModels);
    on('fallback-key-input', 'input', fetchFallbackModels);
    on('fallback-model-select', 'change', onFallbackModelSelectDropdown);

    // --- Editor
    on('edit-name', 'input', (e) => updateAspectData('name', e.target.value));
    on('edit-desc', 'input', (e) => updateAspectData('description', e.target.value));
    on('edit-instructions', 'input', (e) => updateAspectData('instructions', e.target.value));
    on('edit-knowledge', 'input', (e) => updateAspectData('knowledge', e.target.value));
    on('edit-basic-instructions', 'input', updateBasicInstructions);
    on('edit-basic-tone', 'input', updateBasicInstructions);
    on('advanced-mode-toggle', 'change', toggleAdvancedMode);

    on('edit-temperature', 'input', (e) => updateGenerationParam('temperature', e.target.value));
    on('edit-top-p', 'input', (e) => updateGenerationParam('topP', e.target.value));
    on('edit-max-tokens', 'input', (e) => updateGenerationParam('maxTokens', e.target.value));

    // --- File inputs
    on('upload-aspect-input', 'change', loadAspectFile);
    on('upload-icon-input', 'change', uploadIcon);
    on('upload-bg-input', 'change', uploadBackground);
    on('upload-knowledge-input', 'change', uploadKnowledgeFiles);
    on('upload-tools-input', 'change', uploadTools);
    on('import-all-input', 'change', async (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (file) await importAllAspects(file);
    });

    // --- Chat
    on('tools-btn', 'click', toggleToolsDropdown);
    on('chat-input', 'keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendMessage();
        }
    });

    // --- Theme reflects immediately, not only on save.
    on('theme-select', 'change', (e) => applyTheme(e.target.value));
}

/**
 * Keyboard shortcuts for the things done dozens of times a day.
 * Ctrl/Cmd based so they never collide with typing.
 */
function wireShortcuts() {
    const toolEditorOpen = () => {
        const m = document.getElementById('tool-editor-modal');
        return m && !m.classList.contains('hidden');
    };
    const typingInField = (target) => {
        if (!target) return false;
        if (target.isContentEditable) return true;
        const tag = (target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
        return !!target.closest('.cm-editor'); // CodeMirror
    };

    document.addEventListener('keydown', (event) => {
        const mod = event.ctrlKey || event.metaKey;
        if (!mod || event.repeat) return;

        const key = event.key.toLowerCase();

        // Ctrl/Cmd+S inside the tool editor saves the tool, not a .aspect export.
        if (key === 's' && toolEditorOpen()) {
            event.preventDefault();
            saveToolCode();
            return;
        }

        // Don't hijack keystrokes while the user is typing, except for the two
        // that are unambiguous "app chrome" actions (settings, view switch).
        if (typingInField(event.target) && key !== ',' && key !== 'e') return;

        switch (key) {
            case 'k': // new chat
                event.preventDefault();
                newConversation();
                break;
            case 's': // export the current Aspect
                event.preventDefault();
                saveAspectToFile();
                break;
            case ',': // settings, matching the platform convention
                event.preventDefault();
                openSettings();
                renderSnapshotList();
                break;
            case 'e': // jump between chat and editor
                event.preventDefault();
                if (document.getElementById('editor-view').classList.contains('hidden')) {
                    showEditorView();
                } else {
                    showChatView();
                }
                break;
            default:
                break;
        }
    });
}

/**
 * Aspect writes are debounced, so a tab closed immediately after typing could
 * lose the last few hundred milliseconds of edits. Flush on the events that
 * actually fire reliably before teardown.
 */
function wirePersistenceFlush() {
    const flush = () => { flushAspects().catch(err => console.error('Final save failed', err)); };

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
    });
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
}

document.addEventListener('DOMContentLoaded', async () => {
    wireDelegatedClicks();
    wireInputs();
    wireShortcuts();
    wirePersistenceFlush();

    initToolEditor();

    try {
        await init();
    } catch (err) {
        console.error('Aspect Studio failed to start', err);
        showToast(`Aspect Studio failed to start: ${err.message}`, 'error');
    }
});

export { persistAspects, loadDefaultAspects, createNewAspect, applyAspectBackground, renderPresetBgGrid, selectPresetBackground };
