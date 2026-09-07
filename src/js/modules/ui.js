import { insertToolTag } from './tools.js';
import { renderChatMessages } from './chat.js';
import { getGenericIcon, renderAspectList, getCurrentAspect, updateAspectData, loadDefaultAspects, isToolTrusted, aspectHasUntrustedTools } from './aspects.js';
import { armPersistence } from './persist.js';
import { generateIcon } from './imagegen.js';
import { persistAspects, DEFAULT_PARAMS, getGenerationParams } from './state.js';
import { systemTools } from './systemTools.js';
import { state } from './state.js';
import { getKnowledgeFilesRaw, deleteKnowledgeFile } from './db.js';
import {
    sortedConversations,
    startConversation,
    switchConversation,
    deleteConversation,
    renameConversation,
    lockConversationTitle,
    getActiveConversation
} from './conversations.js';

export function showToast(message, type = 'info', action = null) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerText = message;

    // An optional inline action button (e.g. "Undo"). Given a longer life so
    // there is time to click it.
    let life = 3500;
    if (action && action.label && typeof action.onClick === 'function') {
        life = 8000;
        toast.classList.add('has-action');
        const btn = document.createElement('button');
        btn.className = 'toast-action';
        btn.innerText = action.label;
        btn.onclick = () => {
            try { action.onClick(); } finally { toast.remove(); }
        };
        toast.appendChild(btn);
    }

    container.appendChild(toast);
    setTimeout(() => {
        if (toast.parentElement) toast.remove();
    }, life); // Wait for animations to finish
}
window.showToast = showToast;

export function markChangesUnsaved() {
    state.hasUnsavedChanges = true;

    // The banner is a backup reminder, not a data-loss warning: changes are
    // already durable in IndexedDB. Once dismissed it stays down for the rest
    // of the session, and the sidebar button's pulse carries the hint instead.
    if (!state.saveReminderDismissed) {
        const reminder = document.getElementById('save-reminder');
        if (reminder) reminder.classList.remove('hidden');
    }

    const saveBtn = document.getElementById('sidebar-save-btn');
    if (saveBtn) saveBtn.classList.add('pulsate');
    persistAspects();
}

/**
 * Shown when the Aspect library could not be read at startup. Critically, the
 * app does NOT rebuild-and-persist a default library in this case (that path
 * would let the debounced save purge the rows we merely failed to read), so
 * this overlay is the only way forward: retry, or explicitly start fresh.
 */
export function showStorageError() {
    const overlay = document.getElementById('storage-error-overlay');
    if (overlay) {
        overlay.classList.remove('hidden');
        return;
    }
    // Overlay markup missing (older index.html) — fall back to a blocking alert.
    if (typeof window !== 'undefined' && window.alert) {
        window.alert(
            'Aspect Studio could not read your saved Aspects from this browser.\n\n' +
            'Your data has NOT been touched. Reload to try again. If it keeps failing, ' +
            'your browser storage may be blocked or corrupted.'
        );
    }
}
window.showStorageError = showStorageError;

/** "Start fresh" from the storage-error overlay: re-arm writes, build a default. */
export async function storageStartFresh() {
    if (!window.confirm(
        'Start with a new, empty library?\n\n' +
        'If your old Aspects are still in this browser they will be overwritten. ' +
        'Only do this if you have a backup, or accept losing them.'
    )) return;

    armPersistence();
    const overlay = document.getElementById('storage-error-overlay');
    if (overlay) overlay.classList.add('hidden');
    await loadDefaultAspects();
}
window.storageStartFresh = storageStartFresh;

/** Hide the export reminder until this tab is reloaded. */
export function dismissSaveReminder() {
    state.saveReminderDismissed = true;
    const reminder = document.getElementById('save-reminder');
    if (reminder) reminder.classList.add('hidden');
}

export function nextPage(page) {
    document.querySelectorAll('.modal-page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + page).classList.add('active');
}

/* ------------------------------------------------------------------ *
 * Basic / Advanced instruction modes
 * ------------------------------------------------------------------ */

export const TONE_LABELS = [
    'Very Casual & Friendly',
    'Casual',
    'Balanced',
    'Professional',
    'Strictly Formal'
];

/** Render the prompt that Basic mode produces from its two controls. */
export function composeBasicInstructions(description, toneIndex) {
    const tone = TONE_LABELS[Math.min(Math.max(toneIndex, 1), TONE_LABELS.length) - 1];
    return `You are a helpful AI assistant.\n\nCORE DIRECTIVE:\n${description}\n\nTONE:\nYour communication style should be ${tone}.`;
}

/**
 * Recover the Basic-mode fields from a prompt that Basic mode wrote.
 *
 * Returns null for a hand-written prompt, which is the signal that switching
 * to Basic would destroy work. Without this the editor silently showed an
 * empty Basic box over a fully written Aspect, and the first nudge of the tone
 * slider overwrote the real instructions with an empty directive.
 */
export function parseBasicInstructions(instructions) {
    if (typeof instructions !== 'string') return null;
    const match = instructions.match(
        /^You are a helpful AI assistant\.\s*\n\nCORE DIRECTIVE:\n([\s\S]*?)\n\nTONE:\nYour communication style should be (.+?)\.\s*$/
    );
    if (!match) return null;

    const toneIndex = TONE_LABELS.indexOf(match[2].trim());
    if (toneIndex === -1) return null;

    return { description: match[1].trim(), tone: toneIndex + 1 };
}

/**
 * Load the Basic-mode controls for an Aspect, and report whether Basic mode
 * can represent its prompt without losing anything.
 */
function hydrateBasicControls(aspect) {
    const descInput = document.getElementById('edit-basic-instructions');
    const toneInput = document.getElementById('edit-basic-tone');
    const toneLabel = document.getElementById('tone-label');
    if (!descInput || !toneInput) return true;

    let description = aspect.basicDescription;
    let tone = aspect.basicTone;
    let representable = true;

    if (typeof description !== 'string' || !Number.isFinite(tone)) {
        const parsed = parseBasicInstructions(aspect.instructions);
        if (parsed) {
            description = parsed.description;
            tone = parsed.tone;
        } else {
            // A hand-written prompt. Show it verbatim so Basic mode is honest
            // about what it is editing rather than presenting an empty box.
            description = (aspect.instructions || '').trim();
            tone = 3;
            representable = false;
        }
    }

    descInput.value = description;
    toneInput.value = tone;
    if (toneLabel) toneLabel.innerText = TONE_LABELS[tone - 1];
    return representable;
}

export function toggleAdvancedMode() {
    const toggle = document.getElementById('advanced-mode-toggle');
    const slider = document.getElementById('advanced-mode-slider');
    const basicArea = document.getElementById('basic-config-area');
    const advancedArea = document.getElementById('advanced-config-area');
    if (!toggle) return;

    const aspect = getCurrentAspect();

    if (toggle.checked) {
        if (slider) slider.style.transform = 'translateX(22px)';
        if (basicArea) basicArea.classList.add('hidden');
        if (advancedArea) advancedArea.classList.remove('hidden');
        if (aspect) {
            aspect.basicMode = false;
            markChangesUnsaved();
        }
        return;
    }

    // Switching down to Basic: Basic can only express the generated shape, so
    // a custom prompt would be flattened. Ask before doing that.
    if (aspect && !parseBasicInstructions(aspect.instructions) && (aspect.instructions || '').trim()) {
        const proceed = window.confirm(
            'This Aspect has custom System Instructions that Basic mode cannot represent exactly.\n\n' +
            'Switching to Basic will load them as the "What should this Aspect do?" text and re-wrap them ' +
            'with a tone line the next time you edit either control.\n\nSwitch to Basic mode?'
        );
        if (!proceed) {
            toggle.checked = true;
            return;
        }
    }

    if (slider) slider.style.transform = 'translateX(0)';
    if (basicArea) basicArea.classList.remove('hidden');
    if (advancedArea) advancedArea.classList.add('hidden');
    if (aspect) {
        aspect.basicMode = true;
        hydrateBasicControls(aspect);
        markChangesUnsaved();
    }
}

export function updateBasicInstructions() {
    const descInput = document.getElementById('edit-basic-instructions');
    const toneInput = document.getElementById('edit-basic-tone');
    if (!descInput || !toneInput) return;

    const description = descInput.value;
    const toneValue = parseInt(toneInput.value, 10) || 3;

    const toneLabel = document.getElementById('tone-label');
    if (toneLabel) toneLabel.innerText = TONE_LABELS[toneValue - 1];

    const instructions = composeBasicInstructions(description, toneValue);

    const advancedInput = document.getElementById('edit-instructions');
    if (advancedInput) advancedInput.value = instructions;

    const aspect = getCurrentAspect();
    if (aspect) {
        // Remember the Basic inputs so reopening the editor restores them
        // exactly instead of re-deriving (and possibly failing to derive) them.
        aspect.basicDescription = description;
        aspect.basicTone = toneValue;
    }
    updateAspectData('instructions', instructions);
}

/* ------------------------------------------------------------------ *
 * Generation parameters
 * ------------------------------------------------------------------ */

function renderGenerationParams(aspect) {
    const params = getGenerationParams(aspect);

    const bind = (id, value, labelId, format) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.value = value;
        const label = labelId && document.getElementById(labelId);
        if (label) label.innerText = format ? format(value) : value;
    };

    bind('edit-temperature', params.temperature, 'temperature-label', v => Number(v).toFixed(2));
    bind('edit-top-p', params.topP, 'top-p-label', v => Number(v).toFixed(2));
    bind('edit-max-tokens', params.maxTokens || '');
}

export function updateGenerationParam(field, rawValue) {
    const aspect = getCurrentAspect();
    if (!aspect) return;
    if (!aspect.params) aspect.params = {};

    if (field === 'maxTokens') {
        const parsed = parseInt(rawValue, 10);
        aspect.params.maxTokens = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    } else {
        const parsed = parseFloat(rawValue);
        aspect.params[field] = Number.isFinite(parsed) ? parsed : DEFAULT_PARAMS[field];
    }

    const labels = { temperature: 'temperature-label', topP: 'top-p-label' };
    const label = labels[field] && document.getElementById(labels[field]);
    if (label) label.innerText = Number(aspect.params[field]).toFixed(2);

    markChangesUnsaved();
}

/* ------------------------------------------------------------------ *
 * Knowledge files
 * ------------------------------------------------------------------ */

/**
 * List the files attached to this Aspect's knowledge bank, with a way to
 * remove them. Previously files could be uploaded but never seen or deleted:
 * they silently kept consuming context on every request.
 */
export async function renderKnowledgeFileList() {
    const list = document.getElementById('knowledge-file-list');
    if (!list) return;

    const aspect = getCurrentAspect();
    if (!aspect) {
        list.innerHTML = '';
        return;
    }

    let files = [];
    try {
        files = await getKnowledgeFilesRaw(aspect.id);
    } catch (e) {
        console.error('Failed to read knowledge files', e);
    }

    list.innerHTML = '';

    const renderTotalRow = () => {
        const manualChars = (aspect.knowledge || '').length;
        const fileChars = files.reduce((sum, f) => sum + (f.text || '').length, 0);
        const total = manualChars + fileChars;
        const cap = (state.settings && state.settings.maxKnowledgeChars) || 100000;
        const totalRow = document.createElement('div');
        totalRow.className = 'knowledge-total' + (total > cap ? ' knowledge-total-over' : '');
        totalRow.textContent = total > cap
            ? `Knowledge bank: ${total.toLocaleString()} chars — over the ${cap.toLocaleString()} limit; the excess is trimmed each request.`
            : `Knowledge bank: ${total.toLocaleString()} / ${cap.toLocaleString()} chars sent per request.`;
        list.appendChild(totalRow);
    };

    if (!files.length) {
        const empty = document.createElement('div');
        empty.className = 'knowledge-empty';
        empty.innerText = 'No files attached.';
        list.appendChild(empty);
        renderTotalRow();
        return;
    }

    files.forEach(file => {
        const row = document.createElement('div');
        row.className = 'knowledge-file-row';

        const name = document.createElement('span');
        name.className = 'knowledge-file-name';
        name.textContent = file.name;
        name.title = file.name;

        const size = document.createElement('span');
        size.className = 'knowledge-file-size';
        const chars = (file.text || '').length;
        size.textContent = chars > 1000 ? `${Math.round(chars / 1000)}k chars` : `${chars} chars`;

        const remove = document.createElement('button');
        remove.className = 'settings-btn danger-btn knowledge-file-remove';
        remove.innerText = 'Remove';
        remove.onclick = async () => {
            try {
                await deleteKnowledgeFile(aspect.id, file.name);
                showToast(`Removed ${file.name} from knowledge.`);
                renderKnowledgeFileList();
            } catch (e) {
                showToast(`Could not remove ${file.name}: ${e.message}`, 'error');
            }
        };

        row.appendChild(name);
        row.appendChild(size);
        row.appendChild(remove);
        list.appendChild(row);
    });

    renderTotalRow();
}
window.renderKnowledgeFileList = renderKnowledgeFileList;

/* ------------------------------------------------------------------ *
 * Views
 * ------------------------------------------------------------------ */

export function showEditorView() {
    const aspect = getCurrentAspect();
    if (!aspect) return;

    document.getElementById('editor-view').classList.remove('hidden');
    document.getElementById('chat-view').classList.add('hidden');

    document.getElementById('edit-name').value = aspect.name;
    document.getElementById('edit-desc').value = aspect.description;
    document.getElementById('edit-instructions').value = aspect.instructions;
    document.getElementById('edit-knowledge').value = aspect.knowledge;

    document.getElementById('icon-preview').src = aspect.icon || getGenericIcon();
    document.getElementById('icon-filename').innerText = aspect.icon ? 'Custom icon loaded' : 'No icon uploaded';

    const iconGenPrompt = document.getElementById('icon-gen-prompt');
    if (iconGenPrompt && !iconGenPrompt.value.trim()) {
        iconGenPrompt.value = aspect.description || aspect.name || '';
    }

    // Restore the editor mode this Aspect was last edited in. An Aspect whose
    // prompt Basic mode cannot represent opens in Advanced, so the real prompt
    // is always what is on screen.
    const advancedToggle = document.getElementById('advanced-mode-toggle');
    if (advancedToggle) {
        const representable = hydrateBasicControls(aspect);
        const useAdvanced = aspect.basicMode === undefined ? !representable : !aspect.basicMode;
        advancedToggle.checked = useAdvanced;

        const slider = document.getElementById('advanced-mode-slider');
        const basicArea = document.getElementById('basic-config-area');
        const advancedArea = document.getElementById('advanced-config-area');
        if (slider) slider.style.transform = useAdvanced ? 'translateX(22px)' : 'translateX(0)';
        if (basicArea) basicArea.classList.toggle('hidden', useAdvanced);
        if (advancedArea) advancedArea.classList.toggle('hidden', !useAdvanced);
    }

    renderGenerationParams(aspect);
    renderKnowledgeFileList();

    const reviewBanner = document.getElementById('tools-review-banner');
    if (reviewBanner) {
        reviewBanner.classList.toggle('hidden', !aspectHasUntrustedTools(aspect));
    }

    const toolsList = document.getElementById('tools-list');
    toolsList.innerHTML = '';
    if (aspect.tools && aspect.tools.length > 0) {
        aspect.tools.forEach((tool, index) => {
            const el = document.createElement('div');
            el.className = 'tool-row';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'tool-row-name';
            const trusted = isToolTrusted(tool);
            nameSpan.innerText = trusted ? tool.name : `${tool.name}  —  ⚠️ not reviewed`;
            if (!trusted) {
                nameSpan.style.opacity = '0.7';
                nameSpan.title = 'This tool will not run until you open it in the editor and enable it.';
            }

            const btns = document.createElement('div');
            btns.className = 'tool-row-actions';

            // Network permission: undefined = ask per origin on first request,
            // true = any origin allowed, false = blocked. Click cycles
            // ask → allowed → blocked → ask, and always clears the remembered
            // per-origin allowlist so the choice starts clean. This is the
            // "until you change it" control the first-use prompt refers to.
            const NET_STATES = [
                { val: undefined, label: '🌐 Network: ask per site', title: 'This tool will prompt the first time it tries to reach each new host.' },
                { val: true, label: '🌐 Network: any site', title: 'This tool may make network requests to any host without prompting.' },
                { val: false, label: '🚫 Network: blocked', title: 'This tool cannot make network requests.' }
            ];
            const netBtn = document.createElement('button');
            netBtn.className = 'settings-btn';
            const paintNet = () => {
                const s = NET_STATES.find(x => x.val === tool.allowNetwork) || NET_STATES[0];
                const remembered = Array.isArray(tool.allowedOrigins) ? tool.allowedOrigins.length : 0;
                netBtn.innerText = (s.val === undefined && remembered)
                    ? `${s.label} (${remembered} allowed)`
                    : s.label;
                netBtn.title = (s.val === undefined && remembered)
                    ? `${s.title}\nAllowed so far: ${tool.allowedOrigins.join(', ')}\nClick to reset.`
                    : s.title;
            };
            paintNet();
            netBtn.onclick = () => {
                const i = NET_STATES.findIndex(x => x.val === tool.allowNetwork);
                tool.allowNetwork = NET_STATES[(i + 1) % NET_STATES.length].val;
                if (tool.allowNetwork === undefined) delete tool.allowNetwork;
                delete tool.allowedOrigins;
                paintNet();
                markChangesUnsaved();
            };

            const editBtn = document.createElement('button');
            editBtn.innerText = '✏️ Edit';
            editBtn.className = 'settings-btn';
            editBtn.onclick = () => window.openToolEditor(index);

            const delBtn = document.createElement('button');
            delBtn.innerText = '🗑️ Delete';
            delBtn.className = 'settings-btn danger-btn';
            delBtn.onclick = () => {
                if (!window.confirm(`Delete the tool "${tool.name}"? This cannot be undone.`)) return;
                aspect.tools.splice(index, 1);
                markChangesUnsaved();
                showEditorView();
            };

            btns.appendChild(netBtn);
            btns.appendChild(editBtn);
            btns.appendChild(delBtn);

            el.appendChild(nameSpan);
            el.appendChild(btns);
            toolsList.appendChild(el);
        });
    } else {
        toolsList.innerHTML = '<span class="tools-empty">No tools added</span>';
    }

    renderPresetBgGrid();

    const bgFilename = document.getElementById('bg-filename');
    if (aspect.background) {
        if (aspect.background.startsWith('data:')) {
            bgFilename.innerText = 'Custom background loaded';
        } else {
            bgFilename.innerText = `Preset: ${aspect.background.split('/').pop()}`;
        }
    } else {
        bgFilename.innerText = 'No background chosen';
    }
}

/** Show which provider and model the next message will actually go to. */
export function updateModelBadge() {
    const badge = document.getElementById('chat-model-badge');
    if (!badge) return;

    const { provider, apiUrl, model } = state.settings;

    if (provider === 'webllm') {
        badge.textContent = model ? `WebLLM · ${model}` : 'WebLLM · no model selected';
        badge.className = 'model-badge' + (model ? '' : ' model-badge-warn');
        badge.title = 'Running in-browser via WebGPU';
        return;
    }

    if (!apiUrl) {
        badge.textContent = 'No provider configured';
        badge.className = 'model-badge model-badge-warn';
        badge.title = 'Open API Settings to choose a provider';
        return;
    }

    let host = apiUrl;
    try {
        host = new URL(apiUrl).host;
    } catch { /* partially typed URL — show it as entered */ }

    badge.textContent = model ? `${host} · ${model}` : host;
    badge.className = 'model-badge';
    badge.title = `${apiUrl}${model ? `\nModel: ${model}` : ''}`;
}

export function showChatView() {
    const aspect = getCurrentAspect();
    if (!aspect) return;

    document.getElementById('editor-view').classList.add('hidden');
    document.getElementById('chat-view').classList.remove('hidden');

    applyAspectBackground();

    document.getElementById('chat-aspect-icon').src = aspect.icon || getGenericIcon();
    document.getElementById('chat-aspect-name').innerText = aspect.name;
    document.getElementById('chat-aspect-desc').innerText = aspect.description;

    updateModelBadge();
    renderConversationList();

    // Populate tools dropdown
    const dropdown = document.getElementById('tools-dropdown');
    if (dropdown) {
        dropdown.innerHTML = '';
        if (aspect.tools && aspect.tools.length > 0) {
            aspect.tools.forEach(tool => {
                const item = document.createElement('div');
                item.className = 'dropdown-item';
                item.innerText = tool.name;
                item.onclick = () => insertToolTag(tool.name);
                dropdown.appendChild(item);
            });
        } else {
            const empty = document.createElement('div');
            empty.className = 'dropdown-item dropdown-item-empty';
            empty.innerText = 'No tools on this Aspect';
            dropdown.appendChild(empty);
        }
    }

    renderChatMessages();
}

/* ------------------------------------------------------------------ *
 * Conversations
 * ------------------------------------------------------------------ */

export function renderConversationList() {
    const list = document.getElementById('conversation-list');
    if (!list) return;

    const aspect = getCurrentAspect();
    if (!aspect) {
        list.innerHTML = '';
        return;
    }

    list.innerHTML = '';
    sortedConversations(aspect).forEach(conv => {
        const item = document.createElement('div');
        item.className = 'conversation-item' + (conv.id === aspect.activeConversationId ? ' active' : '');

        const title = document.createElement('button');
        title.className = 'conversation-title';
        title.textContent = conv.title || 'New chat';
        title.title = conv.title || 'New chat';
        title.onclick = () => selectConversation(conv.id);

        const actions = document.createElement('div');
        actions.className = 'conversation-actions';

        const renameBtn = document.createElement('button');
        renameBtn.className = 'conversation-action';
        renameBtn.innerText = '✏️';
        renameBtn.title = 'Rename chat';
        renameBtn.onclick = (e) => {
            e.stopPropagation();
            promptRenameConversation(conv.id);
        };

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'conversation-action';
        deleteBtn.innerText = '🗑️';
        deleteBtn.title = 'Delete chat';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            confirmDeleteConversation(conv.id);
        };

        actions.appendChild(renameBtn);
        actions.appendChild(deleteBtn);

        item.appendChild(title);
        item.appendChild(actions);
        list.appendChild(item);
    });
}

export function newConversation() {
    const aspect = getCurrentAspect();
    if (!aspect) return;
    if (state.isGenerating) {
        showToast('Wait for the current response to finish first.', 'error');
        return;
    }
    startConversation(aspect);
    markChangesUnsaved();
    renderConversationList();
    renderChatMessages();
    const input = document.getElementById('chat-input');
    if (input) input.focus();
}

export function selectConversation(conversationId) {
    const aspect = getCurrentAspect();
    if (!aspect) return;
    if (state.isGenerating) {
        showToast('Wait for the current response to finish first.', 'error');
        return;
    }
    if (!switchConversation(aspect, conversationId)) return;
    markChangesUnsaved();
    renderConversationList();
    renderChatMessages();
}

export function promptRenameConversation(conversationId) {
    const aspect = getCurrentAspect();
    if (!aspect) return;
    const conv = aspect.conversations.find(c => c.id === conversationId);
    if (!conv) return;

    const next = window.prompt('Rename this chat:', conv.title || '');
    if (next === null) return;
    renameConversation(aspect, conversationId, next);
    lockConversationTitle(aspect, conversationId);
    markChangesUnsaved();
    renderConversationList();
}

export function confirmDeleteConversation(conversationId) {
    const aspect = getCurrentAspect();
    if (!aspect) return;
    if (state.isGenerating) {
        showToast('Wait for the current response to finish first.', 'error');
        return;
    }
    const conv = aspect.conversations.find(c => c.id === conversationId);
    if (!conv) return;

    const isEmpty = !conv.messages || conv.messages.length === 0;
    if (!isEmpty && !window.confirm(`Delete "${conv.title}"? This chat's messages will be lost.`)) {
        return;
    }

    deleteConversation(aspect, conversationId);
    markChangesUnsaved();
    renderConversationList();
    renderChatMessages();
}

/* ------------------------------------------------------------------ *
 * File uploads (icon & tools)
 * ------------------------------------------------------------------ */

export function uploadIcon(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const aspect = getCurrentAspect();
        if (aspect) {
            aspect.icon = e.target.result;
            document.getElementById('icon-preview').src = e.target.result;
            document.getElementById('icon-filename').innerText = file.name;
            renderAspectList();
            markChangesUnsaved();
        }
    };
    reader.onerror = () => showToast(`Could not read ${file.name}.`, 'error');
    reader.readAsDataURL(file);
    event.target.value = '';
}

let iconGenBusy = false;

/**
 * Generate an Aspect icon from a text description via pollinations.ai.
 * Each click uses a fresh random seed, so re-clicking gives a new take.
 */
export async function generateAspectIcon() {
    if (iconGenBusy) return;
    const aspect = getCurrentAspect();
    if (!aspect) return;

    const promptInput = document.getElementById('icon-gen-prompt');
    const btn = document.getElementById('generate-icon-btn');
    const description = (promptInput && promptInput.value.trim())
        || aspect.description
        || aspect.name;

    iconGenBusy = true;
    const label = btn ? btn.innerText : '';
    if (btn) { btn.disabled = true; btn.innerText = 'Generating…'; }
    showToast('Generating an icon… this can take a few seconds.');

    try {
        const dataUri = await generateIcon(description);
        aspect.icon = dataUri;
        const preview = document.getElementById('icon-preview');
        if (preview) preview.src = dataUri;
        const fname = document.getElementById('icon-filename');
        if (fname) fname.innerText = 'Generated icon';
        renderAspectList();
        markChangesUnsaved();
        showToast('Icon generated. Click again for a different take.');
    } catch (err) {
        showToast(err.message || 'Icon generation failed.', 'error');
    } finally {
        iconGenBusy = false;
        if (btn) { btn.disabled = false; btn.innerText = label || '✨ Generate icon'; }
    }
}

export function uploadTools(event) {
    const files = Array.from(event.target.files);
    const aspect = getCurrentAspect();
    if (!aspect) return;

    let loadedCount = 0;
    const finish = () => {
        loadedCount++;
        if (loadedCount === files.length) {
            showEditorView();
            markChangesUnsaved();
        }
    };

    files.forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const existingIdx = aspect.tools.findIndex(t => t.name === file.name);
            if (existingIdx !== -1) {
                aspect.tools[existingIdx].code = e.target.result;
            } else {
                aspect.tools.push({
                    name: file.name,
                    code: e.target.result,
                    state: {}
                });
            }
            finish();
        };
        reader.onerror = () => {
            showToast(`Could not read ${file.name}.`, 'error');
            finish();
        };
        reader.readAsText(file);
    });
    event.target.value = '';
}

export function openSystemToolsModal() {
    const list = document.getElementById('system-tools-list');
    list.innerHTML = '';
    systemTools.forEach(tool => {
        const el = document.createElement('div');
        el.className = 'system-tool-row';

        const info = document.createElement('div');
        const strong = document.createElement('strong');
        strong.textContent = tool.name;
        const desc = document.createElement('span');
        desc.className = 'system-tool-desc';
        desc.textContent = tool.description;
        info.appendChild(strong);
        info.appendChild(document.createElement('br'));
        info.appendChild(desc);

        const addBtn = document.createElement('button');
        addBtn.className = 'settings-btn';
        addBtn.innerText = 'Add';
        addBtn.onclick = () => addSystemTool(tool);

        el.appendChild(info);
        el.appendChild(addBtn);
        list.appendChild(el);
    });
    document.getElementById('system-tools-modal').classList.remove('hidden');
}

export function addSystemTool(systemTool) {
    const aspect = getCurrentAspect();
    if (!aspect) return;
    if (!aspect.tools) aspect.tools = [];
    const existingIdx = aspect.tools.findIndex(t => t.name === systemTool.name);
    if (existingIdx !== -1) {
        aspect.tools[existingIdx].code = systemTool.code;
    } else {
        aspect.tools.push({ name: systemTool.name, code: systemTool.code, state: {} });
    }
    markChangesUnsaved();
    document.getElementById('system-tools-modal').classList.add('hidden');
    showEditorView();
}

/* ------------------------------------------------------------------ *
 * Backgrounds
 * ------------------------------------------------------------------ */

const PRESET_BACKGROUNDS = [
    { name: 'Lake Sunset 1', file: 'lake_sunset_001.jpeg' },
    { name: 'Lake Sunset 2', file: 'lake_sunset_002.jpeg' },
    { name: 'Mountains Dusk 1', file: 'mountains_dusk_001.jpeg' },
    { name: 'Mountains Dusk 2', file: 'mountains_dusk_002.jpeg' },
    { name: 'Mountains Late Night 1', file: 'mountains_late_night_001.jpeg' },
    { name: 'Mountains Late Night 2', file: 'mountains_late_night_002.jpeg' },
    { name: 'Mountains Morning 1', file: 'mountains_morning_001.jpeg' },
    { name: 'Mountains Morning 2', file: 'mountains_morning_002.jpeg' },
    { name: 'Mountains Rain 1', file: 'mountains_rain_001.jpeg' },
    { name: 'Mountains Rain 2', file: 'mountains_rain_002.jpeg' },
    { name: 'Mountains Snow 1', file: 'mountains_snow_001.jpeg' },
    { name: 'Mountains Snow 2', file: 'mountains_snow_002.jpeg' },
    { name: 'Valley Dusk 1', file: 'valley_dusk_001.jpeg' },
    { name: 'Valley Dusk 2', file: 'valley_dusk_002.jpeg' }
];

export function applyAspectBackground() {
    const aspect = getCurrentAspect();
    if (!aspect) return;

    let bgUrl;
    if (aspect.background) {
        if (aspect.background.startsWith('data:')) {
            bgUrl = `url("${aspect.background}")`;
        } else {
            bgUrl = `url("./${aspect.background}")`;
        }
    } else {
        bgUrl = 'linear-gradient(135deg, #f5ece1 0%, #e8dec8 100%)';
    }
    document.body.style.backgroundImage = bgUrl;
}

export function renderPresetBgGrid() {
    const grid = document.getElementById('preset-bg-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const aspect = getCurrentAspect();

    const noneItem = document.createElement('div');
    noneItem.className = 'preset-bg-item preset-bg-none' + (aspect && !aspect.background ? ' active' : '');
    noneItem.title = 'No background';
    noneItem.innerText = 'None';
    noneItem.onclick = () => selectPresetBackground('');
    grid.appendChild(noneItem);

    PRESET_BACKGROUNDS.forEach(preset => {
        const item = document.createElement('div');
        const path = `alone_image_pack/${preset.file}`;
        const isActive = aspect && aspect.background === path;

        item.className = 'preset-bg-item' + (isActive ? ' active' : '');
        item.style.backgroundImage = `url('./${path}')`;
        item.title = preset.name;
        item.onclick = () => selectPresetBackground(path);
        grid.appendChild(item);
    });
}

export function selectPresetBackground(path) {
    const aspect = getCurrentAspect();
    if (!aspect) return;
    aspect.background = path;
    const label = document.getElementById('bg-filename');
    if (label) label.innerText = path ? `Preset: ${path.split('/').pop()}` : 'No background chosen';
    renderPresetBgGrid();
    applyAspectBackground();
    markChangesUnsaved();
}

export function uploadBackground(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const aspect = getCurrentAspect();
        if (aspect) {
            aspect.background = e.target.result;
            document.getElementById('bg-filename').innerText = `Custom: ${file.name}`;
            renderPresetBgGrid();
            applyAspectBackground();
            markChangesUnsaved();
        }
    };
    reader.onerror = () => showToast(`Could not read ${file.name}.`, 'error');
    reader.readAsDataURL(file);
    event.target.value = '';
}

/* ------------------------------------------------------------------ *
 * Chat loading state
 * ------------------------------------------------------------------ */

export function setChatLoadingState(isLoading) {
    const sendBtn = document.getElementById('send-btn');
    const stopBtn = document.getElementById('stop-btn');
    const input = document.getElementById('chat-input');

    if (isLoading) {
        if (sendBtn) {
            sendBtn.disabled = true;
            sendBtn.classList.add('hidden');
        }
        if (stopBtn) stopBtn.classList.remove('hidden');
        // The input stays enabled so the next message can be typed while the
        // model is still answering; only sending is blocked.
        if (input) input.setAttribute('data-generating', 'true');
    } else {
        if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.classList.remove('hidden');
        }
        if (stopBtn) stopBtn.classList.add('hidden');
        if (input) {
            input.removeAttribute('data-generating');
            input.disabled = false;
            input.focus();
        }
    }
}

/** Conversations exist per Aspect; expose the active one for callers that need it. */
export { getActiveConversation };
