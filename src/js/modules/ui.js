import { insertToolTag } from './tools.js';
import { renderChatMessages } from './chat.js';
import { getGenericIcon, renderAspectList, getCurrentAspect, updateAspectData } from './aspects.js';
import { saveAspectsToLocalStorage } from './state.js';
import { systemTools } from './systemTools.js';
import { state } from './state.js';


        export function showToast(message, type = 'info') {
            const container = document.getElementById('toast-container');
            if (!container) return;
            const toast = document.createElement('div');
            toast.className = `toast ${type}`;
            toast.innerText = message;
            container.appendChild(toast);
            setTimeout(() => {
                if (toast.parentElement) {
                    toast.remove();
                }
            }, 3500); // Wait for animations to finish
        }
        window.showToast = showToast;

        export function markChangesUnsaved() {
            state.hasUnsavedChanges = true;
            document.getElementById('save-reminder').classList.remove('hidden');
            document.getElementById('sidebar-save-btn').classList.add('pulsate');
            saveAspectsToLocalStorage();
        }

        export function nextPage(page) {
            document.querySelectorAll('.modal-page').forEach(p => p.classList.remove('active'));
            document.getElementById('page-' + page).classList.add('active');
        }

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
            
            const toolsList = document.getElementById('tools-list');
            toolsList.innerHTML = '';
            if (aspect.tools && aspect.tools.length > 0) {
                aspect.tools.forEach((tool, index) => {
                    const el = document.createElement('div');
                    el.style.display = 'flex';
                    el.style.justifyContent = 'space-between';
                    el.style.alignItems = 'center';
                    el.style.padding = '8px';
                    el.style.marginBottom = '8px';
                    el.style.background = 'var(--bg-panel)';
                    el.style.borderRadius = '8px';
                    el.style.border = '1px solid var(--border-color)';
                    
                    const nameSpan = document.createElement('span');
                    nameSpan.innerText = tool.name;
                    nameSpan.style.fontWeight = 'bold';
                    nameSpan.style.color = 'var(--accent-primary)';
                    
                    const btns = document.createElement('div');
                    btns.style.display = 'flex';
                    btns.style.gap = '5px';
                    
                    const editBtn = document.createElement('button');
                    editBtn.innerText = '✏️ Edit';
                    editBtn.className = 'settings-btn';
                    editBtn.style.padding = '4px 8px';
                    editBtn.style.fontSize = '0.8rem';
                    editBtn.onclick = () => openToolEditor(index);
                    
                    const delBtn = document.createElement('button');
                    delBtn.innerText = '🗑️ Delete';
                    delBtn.className = 'settings-btn danger-btn';
                    delBtn.style.padding = '4px 8px';
                    delBtn.style.fontSize = '0.8rem';
                    delBtn.onclick = () => {
                        aspect.tools.splice(index, 1);
                        markChangesUnsaved();
                        showEditorView();
                    };
                    
                    btns.appendChild(editBtn);
                    btns.appendChild(delBtn);
                    
                    el.appendChild(nameSpan);
                    el.appendChild(btns);
                    toolsList.appendChild(el);
                });
            } else {
                toolsList.innerHTML = '<span style="font-weight: bold; color: var(--accent-primary); display: block; text-align: center;">No tools added</span>';
            }

            renderPresetBgGrid();
            
            const bgFilename = document.getElementById('bg-filename');
            if (aspect.background) {
                if (aspect.background.startsWith('data:')) {
                    bgFilename.innerText = "Custom background loaded";
                } else {
                    bgFilename.innerText = `Preset: ${aspect.background.split('/').pop()}`;
                }
            } else {
                bgFilename.innerText = "No background chosen";
            }
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

            // Populate tools dropdown
            const dropdown = document.getElementById('tools-dropdown');
            dropdown.innerHTML = '<div class="dropdown-item" onclick="insertToolTag(\'RunAll\')">Run All Tools</div>';
            if (aspect.tools) {
                aspect.tools.forEach(tool => {
                    const item = document.createElement('div');
                    item.className = 'dropdown-item';
                    item.innerText = tool.name;
                    item.onclick = () => insertToolTag(tool.name);
                    dropdown.appendChild(item);
                });
            }

            renderChatMessages();
        }

        // --- FILE UPLOADS (ICON & TOOLS) ---
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
            reader.readAsDataURL(file);
        }

        export function uploadTools(event) {
            const files = Array.from(event.target.files);
            const aspect = getCurrentAspect();
            if (!aspect) return;
            
            let loadedCount = 0;
            files.forEach(file => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const existingIdx = aspect.tools.findIndex(t => t.name === file.name);
                    if (existingIdx !== -1) {
                        aspect.tools[existingIdx].code = e.target.result;
                    } else {
                        aspect.tools.push({
                            name: file.name,
                            code: e.target.result
                        });
                    }
                    loadedCount++;
                    if (loadedCount === files.length) {
                        showEditorView();
                        markChangesUnsaved();
                    }
                };
                reader.readAsText(file);
            });
        }
        
        export function openSystemToolsModal() {
            const list = document.getElementById('system-tools-list');
            list.innerHTML = '';
            systemTools.forEach(tool => {
                const el = document.createElement('div');
                el.style.padding = '10px';
                el.style.border = '1px solid var(--border-color)';
                el.style.borderRadius = '8px';
                el.style.background = 'var(--bg-input)';
                el.style.display = 'flex';
                el.style.justifyContent = 'space-between';
                el.style.alignItems = 'center';
                
                const info = document.createElement('div');
                info.innerHTML = `<strong style="color: var(--accent-primary);">${tool.name}</strong><br><span style="font-size:0.85rem; color: var(--text-light);">${tool.description}</span>`;
                
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

        // --- BACKGROUND PACK SELECTION & CONFIGURATION ---
        const PRESET_BACKGROUNDS = [
            { name: "Lake Sunset 1", file: "lake_sunset_001.jpeg" },
            { name: "Lake Sunset 2", file: "lake_sunset_002.jpeg" },
            { name: "Mountains Dusk 1", file: "mountains_dusk_001.jpeg" },
            { name: "Mountains Dusk 2", file: "mountains_dusk_002.jpeg" },
            { name: "Mountains Late Night 1", file: "mountains_late_night_001.jpeg" },
            { name: "Mountains Late Night 2", file: "mountains_late_night_002.jpeg" },
            { name: "Mountains Morning 1", file: "mountains_morning_001.jpeg" },
            { name: "Mountains Morning 2", file: "mountains_morning_002.jpeg" },
            { name: "Mountains Rain 1", file: "mountains_rain_001.jpeg" },
            { name: "Mountains Rain 2", file: "mountains_rain_002.jpeg" },
            { name: "Mountains Snow 1", file: "mountains_snow_001.jpeg" },
            { name: "Mountains Snow 2", file: "mountains_snow_002.jpeg" },
            { name: "Valley Dusk 1", file: "valley_dusk_001.jpeg" },
            { name: "Valley Dusk 2", file: "valley_dusk_002.jpeg" }
        ];

        export function applyAspectBackground() {
            const aspect = getCurrentAspect();
            if (!aspect) return;
            
            let bgUrl = '';
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
            
            PRESET_BACKGROUNDS.forEach(preset => {
                const item = document.createElement('div');
                const path = `alone_image_pack/${preset.file}`;
                const isActive = aspect && aspect.background === path;
                
                item.style.cssText = `
                    border: 3px solid ${isActive ? 'var(--accent-secondary)' : 'var(--border-color)'};
                    border-radius: 8px;
                    overflow: hidden;
                    cursor: pointer;
                    height: 50px;
                    background-image: url('./${path}');
                    background-size: cover;
                    background-position: center;
                    box-shadow: ${isActive ? '0 0 6px var(--accent-secondary)' : 'none'};
                    position: relative;
                    transition: border-color 0.15s, box-shadow 0.15s;
                `;
                item.title = preset.name;
                item.onclick = () => selectPresetBackground(path);
                grid.appendChild(item);
            });
        }

        export function selectPresetBackground(path) {
            const aspect = getCurrentAspect();
            if (aspect) {
                aspect.background = path;
                document.getElementById('bg-filename').innerText = `Preset: ${path.split('/').pop()}`;
                renderPresetBgGrid();
                applyAspectBackground();
                markChangesUnsaved();
            }
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
            reader.readAsDataURL(file);
        }

        export function toggleAdvancedMode() {
            const toggle = document.getElementById('advanced-mode-toggle');
            const slider = document.getElementById('advanced-mode-slider');
            const basicArea = document.getElementById('basic-config-area');
            const advancedArea = document.getElementById('advanced-config-area');

            if (toggle.checked) {
                slider.style.transform = 'translateX(22px)';
                basicArea.classList.add('hidden');
                advancedArea.classList.remove('hidden');
            } else {
                slider.style.transform = 'translateX(0)';
                basicArea.classList.remove('hidden');
                advancedArea.classList.add('hidden');
            }
        }

        export function updateBasicInstructions() {
            const basicDesc = document.getElementById('edit-basic-instructions').value;
            const toneValue = document.getElementById('edit-basic-tone').value;
            const toneLabels = ["Very Casual & Friendly", "Casual", "Balanced", "Professional", "Strictly Formal"];

            document.getElementById('tone-label').innerText = toneLabels[toneValue - 1];

            let toneInstruction = toneLabels[toneValue - 1];

            const newInstructions = `You are a helpful AI assistant.\n\nCORE DIRECTIVE:\n${basicDesc}\n\nTONE:\nYour communication style should be ${toneInstruction}.`;

            document.getElementById('edit-instructions').value = newInstructions;
            updateAspectData('instructions', newInstructions);
        }

export function setChatLoadingState(isLoading) {
    if (isLoading) {
        document.getElementById('send-btn').disabled = true;
        document.getElementById('send-btn').classList.add('hidden');
        document.getElementById('stop-btn').classList.remove('hidden');
        document.getElementById('chat-input').disabled = true;
    } else {
        document.getElementById('send-btn').disabled = false;
        document.getElementById('send-btn').classList.remove('hidden');
        document.getElementById('stop-btn').classList.add('hidden');
        document.getElementById('chat-input').disabled = false;
        document.getElementById('chat-input').focus();
    }
}
