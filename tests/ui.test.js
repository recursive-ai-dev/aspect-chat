import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/dom';
import * as ui from '../src/js/modules/ui.js';
import * as stateModule from '../src/js/modules/state.js';
import * as aspectsModule from '../src/js/modules/aspects.js';
import * as toolsModule from '../src/js/modules/tools.js';

vi.mock('../src/js/modules/state.js', () => ({
    state: { hasUnsavedChanges: false },
    saveAspectsToLocalStorage: vi.fn(),
}));

vi.mock('../src/js/modules/aspects.js', () => ({
    getCurrentAspect: vi.fn(),
    getGenericIcon: vi.fn().mockReturnValue('generic-icon.png'),
    renderAspectList: vi.fn(),
    updateAspectData: vi.fn()
}));

vi.mock('../src/js/modules/tools.js', () => ({
    insertToolTag: vi.fn()
}));

vi.mock('../src/js/modules/chat.js', () => ({
    renderChatMessages: vi.fn()
}));

vi.mock('../src/js/modules/ui.js', async (importOriginal) => {
    const mod = await importOriginal();
    return {
        ...mod
    };
});

describe('UI Module', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="toast-container"></div>
            <div id="save-reminder" class="hidden"></div>
            <button id="sidebar-save-btn"></button>
            <div id="page-1" class="modal-page active"></div>
            <div id="page-2" class="modal-page"></div>
            
            <div id="editor-view" class="hidden">
                <input id="edit-name" />
                <textarea id="edit-desc"></textarea>
                <textarea id="edit-instructions"></textarea>
                <textarea id="edit-knowledge"></textarea>
                <img id="icon-preview" />
                <div id="icon-filename"></div>
                <div id="tools-list"></div>
                <div id="bg-filename"></div>
                <div id="preset-bg-grid"></div>
            </div>
            
            <div id="chat-view" class="hidden">
                <img id="chat-aspect-icon" />
                <div id="chat-aspect-name"></div>
                <div id="chat-aspect-desc"></div>
                <div id="tools-dropdown"></div>
                <button id="send-btn"></button>
                <button id="stop-btn" class="hidden"></button>
                <input id="chat-input" />
            </div>

            <input type="file" id="upload-icon" />
            <input type="file" id="upload-tools" multiple />
            
            <div id="system-tools-modal" class="hidden"></div>
            <div id="system-tools-list"></div>
            
            <div id="preset-bg-grid"></div>
            
            <input type="checkbox" id="advanced-mode-toggle" />
            <div id="advanced-mode-slider"></div>
            <div id="basic-config-area"></div>
            <div id="advanced-config-area" class="hidden"></div>
            
            <textarea id="edit-basic-instructions"></textarea>
            <input type="number" id="edit-basic-tone" value="3" />
            <div id="tone-label"></div>
        `;
        vi.clearAllMocks();
        stateModule.state.hasUnsavedChanges = false;
        
        // Mock setTimeout
        vi.useFakeTimers();
    });
    
    afterEach(() => {
        vi.useRealTimers();
    });

    describe('showToast', () => {
        it('should create and append a toast element', () => {
            ui.showToast('Test Message', 'error');
            const toastContainer = document.getElementById('toast-container');
            expect(toastContainer.children.length).toBe(1);
            expect(toastContainer.children[0]).toHaveProperty('innerText', 'Test Message');
            expect(toastContainer.children[0]).toHaveClass('toast error');
        });
        
        it('should remove toast after 3500ms', () => {
            ui.showToast('Test Message');
            const toastContainer = document.getElementById('toast-container');
            expect(toastContainer.children.length).toBe(1);
            
            vi.advanceTimersByTime(3500);
            
            expect(toastContainer.children.length).toBe(0);
        });
    });

    describe('markChangesUnsaved', () => {
        it('should update UI and call saveAspectsToLocalStorage', () => {
            ui.markChangesUnsaved();
            
            expect(stateModule.state.hasUnsavedChanges).toBe(true);
            expect(document.getElementById('save-reminder')).not.toHaveClass('hidden');
            expect(document.getElementById('sidebar-save-btn')).toHaveClass('pulsate');
            expect(stateModule.saveAspectsToLocalStorage).toHaveBeenCalled();
        });
    });

    describe('nextPage', () => {
        it('should switch active modal page', () => {
            ui.nextPage('2');
            
            expect(document.getElementById('page-1')).not.toHaveClass('active');
            expect(document.getElementById('page-2')).toHaveClass('active');
        });
    });

    describe('setChatLoadingState', () => {
        it('should disable chat input and show stop button when loading', () => {
            ui.setChatLoadingState(true);
            expect(document.getElementById('send-btn').disabled).toBe(true);
            expect(document.getElementById('send-btn')).toHaveClass('hidden');
            expect(document.getElementById('stop-btn')).not.toHaveClass('hidden');
            expect(document.getElementById('chat-input').disabled).toBe(true);
        });

        it('should enable chat input and hide stop button when not loading', () => {
            ui.setChatLoadingState(false);
            expect(document.getElementById('send-btn').disabled).toBe(false);
            expect(document.getElementById('send-btn')).not.toHaveClass('hidden');
            expect(document.getElementById('stop-btn')).toHaveClass('hidden');
            expect(document.getElementById('chat-input').disabled).toBe(false);
        });
    });

    describe('toggleAdvancedMode', () => {
        it('should show advanced area if toggle is checked', () => {
            const toggle = document.getElementById('advanced-mode-toggle');
            toggle.checked = true;
            ui.toggleAdvancedMode();
            
            expect(document.getElementById('basic-config-area')).toHaveClass('hidden');
            expect(document.getElementById('advanced-config-area')).not.toHaveClass('hidden');
        });

        it('should show basic area if toggle is unchecked', () => {
            const toggle = document.getElementById('advanced-mode-toggle');
            toggle.checked = false;
            ui.toggleAdvancedMode();
            
            expect(document.getElementById('basic-config-area')).not.toHaveClass('hidden');
            expect(document.getElementById('advanced-config-area')).toHaveClass('hidden');
        });
    });

    describe('updateBasicInstructions', () => {
        it('should update tone label and aspect instructions based on inputs', () => {
            aspectsModule.getCurrentAspect.mockReturnValue({});
            document.getElementById('edit-basic-instructions').value = 'Help me test this';
            document.getElementById('edit-basic-tone').value = '3';
            
            ui.updateBasicInstructions();
            
            expect(document.getElementById('tone-label')).toHaveProperty('innerText', 'Balanced');
            expect(document.getElementById('edit-instructions').value).toContain('Help me test this');
            expect(document.getElementById('edit-instructions').value).toContain('Balanced');
            expect(aspectsModule.updateAspectData).toHaveBeenCalledWith('instructions', expect.any(String));
        });
    });

    describe('Background Management', () => {
        beforeEach(() => {
            document.body.innerHTML += '<div id="preset-bg-grid"></div><div id="bg-filename"></div>';
        });

        it('selectPresetBackground should update aspect background and UI', () => {
            const aspect = {};
            aspectsModule.getCurrentAspect.mockReturnValue(aspect);
            
            ui.selectPresetBackground('path/to/bg.png');
            
            expect(aspect.background).toBe('path/to/bg.png');
            expect(document.getElementById('bg-filename')).toHaveProperty('innerText', 'Preset: bg.png');
            expect(stateModule.state.hasUnsavedChanges).toBe(true);
        });

        it('uploadBackground should update aspect background and UI with base64', () => {
            const aspect = {};
            aspectsModule.getCurrentAspect.mockReturnValue(aspect);
            
            const mockFile = new Blob(['test'], { type: 'image/png' });
            mockFile.name = 'test.png';
            const event = { target: { files: [mockFile] } };

            class DummyFileReader {
                readAsDataURL() {
                    if (this.onload) {
                        this.onload({ target: { result: 'base64data' } });
                    }
                }
                readAsText() {
                    if (this.onload) {
                        this.onload({ target: { result: 'textdata' } });
                    }
                }
            }
            vi.stubGlobal('FileReader', DummyFileReader);

            ui.uploadBackground(event);

            expect(aspect.background).toBe('base64data');
            expect(document.getElementById('bg-filename')).toHaveProperty('innerText', 'Custom: test.png');
            expect(stateModule.state.hasUnsavedChanges).toBe(true);
            vi.unstubAllGlobals();
        });
    });

    describe('Tools Management', () => {
        beforeEach(() => {
            document.body.innerHTML += `
                <div id="system-tools-modal" class="hidden"></div>
                <div id="system-tools-list"></div>
                <div id="editor-view" class="hidden"></div>
            `;
        });

        it('uploadTools should read files and add to aspect tools', () => {
            const aspect = { tools: [] };
            aspectsModule.getCurrentAspect.mockReturnValue(aspect);
            
            const mockFile1 = new Blob(['test1'], { type: 'text/javascript' });
            mockFile1.name = 'tool1.js';
            const mockFile2 = new Blob(['test2'], { type: 'text/javascript' });
            mockFile2.name = 'tool2.js';
            const event = { target: { files: [mockFile1, mockFile2] } };

            class DummyFileReaderText {
                readAsText() {
                    if (this.onload) {
                        this.onload({ target: { result: 'code content' } });
                    }
                }
            }
            vi.stubGlobal('FileReader', DummyFileReaderText);

            ui.uploadTools(event);

            expect(aspect.tools.length).toBe(2);
            expect(aspect.tools[0].name).toBe('tool1.js');
            expect(aspect.tools[0].code).toBe('code content');
            
            // Should replace existing if name matches
            const event2 = { target: { files: [mockFile1] } };
            ui.uploadTools(event2);
            expect(aspect.tools.length).toBe(2);

            vi.unstubAllGlobals();
        });

        it('openSystemToolsModal should render system tools and show modal', async () => {
            const uiModule = await import('../src/js/modules/ui.js');
            // Mock systemTools.js content for this test implicitly by relying on dom manipulation
            uiModule.openSystemToolsModal();
            expect(document.getElementById('system-tools-modal')).not.toHaveClass('hidden');
        });

        it('addSystemTool should add a tool and switch to editor view', () => {
            const aspect = { tools: [] };
            aspectsModule.getCurrentAspect.mockReturnValue(aspect);
            
            const tool = { name: 'Calc.js', code: 'return 1;' };
            ui.addSystemTool(tool);
            
            expect(aspect.tools.length).toBe(1);
            expect(aspect.tools[0].name).toBe('Calc.js');
            expect(document.getElementById('system-tools-modal')).toHaveClass('hidden');
            expect(stateModule.state.hasUnsavedChanges).toBe(true);

            // Adding again should just replace
            ui.addSystemTool({ name: 'Calc.js', code: 'return 2;' });
            expect(aspect.tools.length).toBe(1);
            expect(aspect.tools[0].code).toBe('return 2;');
        });
    });

    describe('showEditorView', () => {
        it('should return early if no current aspect', () => {
            aspectsModule.getCurrentAspect.mockReturnValue(null);
            ui.showEditorView();
            expect(document.getElementById('editor-view')).toHaveClass('hidden');
        });

        it('should populate editor view with aspect details', () => {
            aspectsModule.getCurrentAspect.mockReturnValue({
                name: 'Test Aspect',
                description: 'Test Desc',
                instructions: 'Test Inst',
                knowledge: 'Test Know',
                icon: 'custom.png',
                tools: [{ name: 'Tool1' }]
            });

            ui.showEditorView();

            expect(document.getElementById('editor-view')).not.toHaveClass('hidden');
            expect(document.getElementById('chat-view')).toHaveClass('hidden');
            
            expect(document.getElementById('edit-name')).toHaveValue('Test Aspect');
            expect(document.getElementById('icon-preview')).toHaveAttribute('src', 'custom.png');
            expect(document.getElementById('tools-list').children.length).toBe(1);
        });
    });

    describe('showChatView', () => {
        it('should populate chat view with aspect details', () => {
            aspectsModule.getCurrentAspect.mockReturnValue({
                name: 'Chat Aspect',
                description: 'Chat Desc',
                tools: [{ name: 'Tool1' }]
            });

            ui.showChatView();

            expect(document.getElementById('editor-view')).toHaveClass('hidden');
            expect(document.getElementById('chat-view')).not.toHaveClass('hidden');
            expect(document.getElementById('chat-aspect-name')).toHaveProperty('innerText', 'Chat Aspect');
            
            const toolsDropdown = document.getElementById('tools-dropdown');
            expect(toolsDropdown.children.length).toBe(2); // 'Run All Tools' + Tool1
        });
    describe('populateAspectSettings', () => {
        it('should populate settings correctly with presets', () => {
            const aspect = {
                id: '1', name: 'A', description: 'B', instructions: 'C',
                tools: [],
                background: 'lake_sunset_001.jpeg',
                icon: ''
            };
            aspectsModule.getCurrentAspect.mockReturnValue(aspect);
            stateModule.state.aspects = [aspect];
            stateModule.state.currentAspectId = '1';
            
            ui.showEditorView(false);
            expect(document.getElementById('bg-filename').innerText).toBe('Preset: lake_sunset_001.jpeg');
        });

        it('should populate settings correctly with data URI background', () => {
            const aspect = {
                id: '1', name: 'A', description: 'B', instructions: 'C',
                tools: [],
                background: 'data:image/png;base64,...',
                icon: ''
            };
            aspectsModule.getCurrentAspect.mockReturnValue(aspect);
            stateModule.state.aspects = [aspect];
            stateModule.state.currentAspectId = '1';
            
            ui.showEditorView(false);
            expect(document.getElementById('bg-filename').innerText).toBe('Custom background loaded');
        });
    });

    describe('applyAspectBackground', () => {
        it('should apply data URI background correctly', () => {
            const aspect = { background: 'data:image/png;base64,...' };
            aspectsModule.getCurrentAspect.mockReturnValue(aspect);
            ui.applyAspectBackground();
            expect(document.body.style.backgroundImage).toContain('data:image/png');
        });
    });

    describe('delete tool', () => {
        it('should delete a tool from aspect when delete button is clicked', () => {
            const aspect = {
                id: '1', name: 'A', description: 'B', instructions: 'C',
                tools: [{name: 'tool1', code: ''}],
                background: '', icon: ''
            };
            aspectsModule.getCurrentAspect.mockReturnValue(aspect);
            stateModule.state.aspects = [aspect];
            stateModule.state.currentAspectId = '1';
            
            ui.showEditorView(false);
            
            // Get delete button
            const toolsList = document.getElementById('tools-list');
            const delBtn = toolsList.querySelector('.danger-btn');
            
            delBtn.click();
            
            expect(aspect.tools.length).toBe(0);
            expect(stateModule.state.hasUnsavedChanges).toBe(true);
        });
    });

    describe('uploadIcon', () => {
        let originalFileReader;
        beforeEach(() => {
            originalFileReader = global.FileReader;
            global.FileReader = class {
                constructor() {
                    FileReader.instances.push(this);
                }
                readAsDataURL() {}
            };
            FileReader.instances = [];
        });

        afterEach(() => {
            global.FileReader = originalFileReader;
        });

        it('should handle icon file upload', () => {
            const aspect = { id: '1', icon: '' };
            aspectsModule.getCurrentAspect.mockReturnValue(aspect);
            
            const file = new File(['dummy icon'], 'icon.png', { type: 'image/png' });
            const event = { target: { files: [file] } };
            
            ui.uploadIcon(event);
            
            const reader = FileReader.instances[0];
            reader.onload({ target: { result: 'data:image/png;base64,mock' } });
            
            expect(aspect.icon).toBe('data:image/png;base64,mock');
            expect(document.getElementById('icon-filename').innerText).toBe('icon.png');
            expect(stateModule.state.hasUnsavedChanges).toBe(true);
        });
    });

    describe('background functions', () => {
        let originalFileReader;

        beforeEach(() => {
            originalFileReader = global.FileReader;
            global.FileReader = class {
                constructor() {
                    FileReader.instances.push(this);
                }
                readAsDataURL() {}
            };
            FileReader.instances = [];
        });

        afterEach(() => {
            global.FileReader = originalFileReader;
        });

        it('should select preset background', () => {
            const aspect = { background: '' };
            aspectsModule.getCurrentAspect.mockReturnValue(aspect);
            
            ui.selectPresetBackground('alone_image_pack/mountains_rain_001.jpeg');
            
            expect(aspect.background).toBe('alone_image_pack/mountains_rain_001.jpeg');
            expect(document.getElementById('bg-filename').innerText).toBe('Preset: mountains_rain_001.jpeg');
            expect(stateModule.state.hasUnsavedChanges).toBe(true);
        });

        it('should upload custom background', () => {
            const aspect = { background: '' };
            aspectsModule.getCurrentAspect.mockReturnValue(aspect);
            
            const event = { target: { files: [new File([''], 'mybg.jpg', { type: 'image/jpeg' })] } };
            ui.uploadBackground(event);
            
            const reader = FileReader.instances[0];
            reader.onload({ target: { result: 'data:image/jpeg;base64,mockbg' } });
            
            expect(aspect.background).toBe('data:image/jpeg;base64,mockbg');
            expect(document.getElementById('bg-filename').innerText).toBe('Custom: mybg.jpg');
            expect(stateModule.state.hasUnsavedChanges).toBe(true);
        });

        it('should render preset bg grid', () => {
            const aspect = { background: 'alone_image_pack/mountains_rain_001.jpeg' };
            aspectsModule.getCurrentAspect.mockReturnValue(aspect);
            
            ui.renderPresetBgGrid();
            
            const grid = document.getElementById('preset-bg-grid');
            expect(grid.children.length).toBeGreaterThan(0);
        });
    });
});

});
