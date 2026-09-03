import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { state, markChangesUnsaved } from '../src/js/modules/state.js';
import { loadDefaultAspects } from '../src/js/modules/aspects.js';
import * as ui from '../src/js/modules/ui.js';
import * as aspects from '../src/js/modules/aspects.js';


// Mock ui and state functions before importing aspects.js
vi.mock('../src/js/modules/ui.js', () => ({
    renderAspectList: vi.fn(),
    showEditorView: vi.fn(),
    showChatView: vi.fn(),
    updateToolsDropdown: vi.fn(),
    applyAspectBackground: vi.fn(),
    markChangesUnsaved: vi.fn()
}));

vi.mock('../src/js/modules/state.js', async (importOriginal) => {
    const mod = await importOriginal();
    return {
        ...mod,
        persistAspects: vi.fn(),
        markChangesUnsaved: vi.fn()
    };
});

vi.mock('../src/js/modules/systemTools.js', () => ({
    systemTools: [
        { name: 'Calculator.js', code: 'test' },
        { name: 'ReadMemory.js', code: 'test' },
        { name: 'WriteMemory.js', code: 'test' },
        { name: 'Weather.js', code: 'test' },
        { name: 'DateTime.js', code: 'test' }
    ]
}));

describe('Aspects Management', () => {
    beforeEach(() => {
        // Reset state
        state.aspects = [];
        state.currentAspectId = null;

        // Setup DOM
        document.body.innerHTML = `
            <div id="aspect-list"></div>
            <div id="create-aspect-modal" class="hidden"></div>
            <div id="template-gallery"></div>
            <input id="create-aspect-name-input" value="Test Name" />
            <input id="create-aspect-desc-input" value="Test Desc" />
            <img id="create-aspect-icon-preview" />
            <div id="create-aspect-icon-filename"></div>
        `;

        // Clear mocks
        vi.clearAllMocks();

        // Setup globals
        window.showToast = vi.fn();
        window.confirm = vi.fn().mockReturnValue(true);
        window.tempCreateIcon = undefined;
    });

    afterEach(() => {
        document.body.innerHTML = '';
        delete window.showToast;
        delete window.confirm;
        delete window.tempCreateIcon;
    });

    describe('getGenericIcon', () => {
        it('should return a valid data URL containing SVG', () => {
            const icon = aspects.getGenericIcon();
            expect(icon).toContain('data:image/svg+xml;base64,');
        });
    });

    describe('getLakesideSageIcon', () => {
        it('should return a valid data URL containing SVG', () => {
            expect(aspects.getLakesideSageIcon()).toContain('data:image/svg+xml;base64,');
        });
    });

    describe('getStudioGuideIcon', () => {
        it('should return a valid data URL containing SVG', () => {
            expect(aspects.getStudioGuideIcon()).toContain('data:image/svg+xml;base64,');
        });
    });

    describe('loadDefaultAspects', () => {
        beforeEach(async () => {
            localStorage.clear();
            const { resetDatabaseForTesting } = await import('../src/js/modules/idb.js');
            const { resetPersistForTesting } = await import('../src/js/modules/persist.js');
            resetPersistForTesting();
            // Fresh database per case so a migrated library from one test does
            // not leak into the next.
            indexedDB.deleteDatabase('AspectKnowledgeDB');
            await resetDatabaseForTesting();
        });

        it('should load saved aspects from localStorage if valid', async () => {
            const savedAspects = [{ id: 'test1', name: 'Saved Aspect' }];
            localStorage.setItem('aspects_data', JSON.stringify(savedAspects));

            await aspects.loadDefaultAspects();

            expect(state.aspects.length).toBe(1);
            expect(state.currentAspectId).toBe('test1');
            const ui = await import('../src/js/modules/ui.js');
            expect(ui.showChatView).toHaveBeenCalled();
        });

        it('should load default Studio Guide if localStorage is empty', async () => {
            await aspects.loadDefaultAspects();

            expect(state.aspects.length).toBe(1);
            expect(state.aspects[0].id).toBe('studio-guide');
            expect(state.currentAspectId).toBe('studio-guide');
            const ui = await import('../src/js/modules/ui.js');
            expect(ui.showChatView).toHaveBeenCalled();
            const stateModule = await import('../src/js/modules/state.js');
            expect(stateModule.persistAspects).toHaveBeenCalled();
        });

        it('should load default Studio Guide if localStorage is invalid JSON', async () => {
            const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

            localStorage.setItem('aspects_data', 'invalid json');
            await aspects.loadDefaultAspects();
            expect(state.aspects.length).toBe(1);
            expect(state.aspects[0].id).toBe('studio-guide');

            spy.mockRestore();
        });
    });

    describe('Aspect Creation', () => {
        it('should show create aspect modal and render templates', () => {
            aspects.createNewAspect();
            expect(document.getElementById('create-aspect-modal')).not.toHaveClass('hidden');
            const gallery = document.getElementById('template-gallery');
            expect(gallery.children.length).toBeGreaterThan(0);
        });

        it('should hide modal on cancelCreateAspect', () => {
            document.getElementById('create-aspect-modal').classList.remove('hidden');
            aspects.cancelCreateAspect();
            expect(document.getElementById('create-aspect-modal')).toHaveClass('hidden');
        });

        it('should create aspect from input and hide modal', () => {
            document.getElementById('create-aspect-name-input').value = 'My Custom Aspect';
            aspects.acceptCreateAspect();
            
            expect(state.aspects.length).toBe(1);
            expect(state.aspects[0].name).toBe('My Custom Aspect');
            expect(document.getElementById('create-aspect-modal')).toHaveClass('hidden');
        });

        it('should create aspect from template', async () => {
            aspects.acceptCreateAspectFromTemplate('data-analyst');
            
            // wait for dynamic import to resolve
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(state.aspects.length).toBe(1);
            expect(state.aspects[0].name).toBe('The Data Analyst');
            expect(document.getElementById('create-aspect-modal')).toHaveClass('hidden');
        });

        it('should create web-researcher aspect with custom tools, custom icon, and chat history', async () => {
            aspects.acceptCreateAspectFromTemplate('web-researcher');
            
            // wait for dynamic import to resolve
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(state.aspects.length).toBe(1);
            const created = state.aspects[0];
            expect(created.name).toBe('Web Researcher & Summary Agent');
            // Check custom tools + system tools matched
            const toolNames = created.tools.map(t => t.name);
            expect(toolNames).toContain('FetchWebsite.js');
            expect(toolNames).toContain('ReadMemory.js');
            expect(toolNames).toContain('WriteMemory.js');
            // Check custom icon
            expect(created.icon).toContain('data:image/svg+xml;base64,');
            // Check custom chat history
            expect(created.chatHistory.length).toBe(1);
            expect(created.chatHistory[0].content).toContain('Web Researcher');
        });

        it('should create tinker-expert aspect with custom tools, custom icon, and chat history', async () => {
            aspects.acceptCreateAspectFromTemplate('tinker-expert');
            
            // wait for dynamic import to resolve
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(state.aspects.length).toBe(1);
            const created = state.aspects[0];
            expect(created.name).toBe('The Tinker & Code Sandbox Expert');
            // Check custom tools + system tools matched
            const toolNames = created.tools.map(t => t.name);
            expect(toolNames).toContain('JSExecutor.js');
            expect(toolNames).toContain('Calculator.js');
            // Check custom icon
            expect(created.icon).toContain('data:image/svg+xml;base64,');
            // Check custom chat history
            expect(created.chatHistory.length).toBe(1);
            expect(created.chatHistory[0].content).toContain('Tinker & Code Sandbox Expert');
        });

        it('should create travel-planner aspect with custom tools, custom icon, and chat history', async () => {
            aspects.acceptCreateAspectFromTemplate('travel-planner');
            
            // wait for dynamic import to resolve
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(state.aspects.length).toBe(1);
            const created = state.aspects[0];
            expect(created.name).toBe('The Serene Travel Planner');
            // Check custom tools + system tools matched
            const toolNames = created.tools.map(t => t.name);
            expect(toolNames).toContain('ItineraryBuilder.js');
            expect(toolNames).toContain('Weather.js');
            expect(toolNames).toContain('DateTime.js');
            // Check custom icon
            expect(created.icon).toContain('data:image/svg+xml;base64,');
            // Check custom chat history
            expect(created.chatHistory.length).toBe(1);
            expect(created.chatHistory[0].content).toContain('Serene Travel Planner');
        });

        it('should create zen-coach aspect with custom tools, custom icon, and chat history', async () => {
            aspects.acceptCreateAspectFromTemplate('zen-coach');
            
            // wait for dynamic import to resolve
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(state.aspects.length).toBe(1);
            const created = state.aspects[0];
            expect(created.name).toBe('The Zen Productivity Coach');
            // Check custom tools + system tools matched
            const toolNames = created.tools.map(t => t.name);
            expect(toolNames).toContain('ManageTasks.js');
            expect(toolNames).toContain('DateTime.js');
            // Check custom icon
            expect(created.icon).toContain('data:image/svg+xml;base64,');
            // Check custom chat history
            expect(created.chatHistory.length).toBe(1);
            expect(created.chatHistory[0].content).toContain('Zen Productivity Coach');
        });

        it('should upload icon correctly', () => {
            const mockFile = new Blob(['test'], { type: 'image/png' });
            mockFile.name = 'test.png';
            const event = { target: { files: [mockFile] } };

            aspects.uploadCreateIcon(event);
        });
    });

    describe('State modifying functions', () => {
        beforeEach(() => {
            state.aspects = [
                { id: '1', name: 'Aspect 1', icon: '' },
                { id: '2', name: 'Aspect 2', icon: '' }
            ];
            state.currentAspectId = '1';
        });

        describe('getCurrentAspect', () => {
            it('should return the aspect matching currentAspectId', () => {
                const aspect = aspects.getCurrentAspect();
                expect(aspect.id).toBe('1');
                expect(aspect.name).toBe('Aspect 1');
            });
            it('should return undefined if no matching aspect', () => {
                state.currentAspectId = '99';
                const aspect = aspects.getCurrentAspect();
                expect(aspect).toBeUndefined();
            });
        });

        describe('selectAspect', () => {
            it('should update currentAspectId and trigger UI updates', async () => {
                aspects.selectAspect('2');

                expect(state.currentAspectId).toBe('2');
                const ui = await import('../src/js/modules/ui.js');
                expect(ui.applyAspectBackground).toHaveBeenCalled();
                expect(ui.showChatView).toHaveBeenCalled();
            });
        });

        describe('updateAspectData', () => {
            it('should update the specified field of the current aspect and mark unsaved', async () => {
                aspects.updateAspectData('name', 'New Name');

                const aspect = aspects.getCurrentAspect();
                expect(aspect.name).toBe('New Name');

                const ui = await import('../src/js/modules/ui.js');
                expect(ui.markChangesUnsaved).toHaveBeenCalled();
            });
        });

        describe('deleteCurrentAspect', () => {
            it('should prevent deletion if only one aspect exists', () => {
                state.aspects = [{ id: '1', name: 'Aspect 1' }];

                aspects.deleteCurrentAspect();

                expect(state.aspects.length).toBe(1);
                expect(window.showToast).toHaveBeenCalledWith(
                    expect.any(String), "error"
                );
            });

            it('should delete aspect if confirmed and switch to another', async () => {
                aspects.deleteCurrentAspect();

                expect(state.aspects.length).toBe(1);
                expect(state.aspects[0].id).toBe('2');
                expect(state.currentAspectId).toBe('2');

                const ui = await import('../src/js/modules/ui.js');
                expect(ui.showChatView).toHaveBeenCalled();
                expect(ui.markChangesUnsaved).toHaveBeenCalled();
            });

            it('should not delete if not confirmed', () => {
                window.confirm.mockReturnValueOnce(false);
                aspects.deleteCurrentAspect();

                expect(state.aspects.length).toBe(2);
            });
        });
    });

    describe('renderAspectList', () => {
        beforeEach(() => {
            state.aspects = [
                { id: '1', name: 'Aspect 1', icon: '' },
                { id: '2', name: 'Aspect 2', icon: 'custom-icon.png' }
            ];
            state.currentAspectId = '1';
        });

        it('should render all aspects and add New Aspect button', () => {
            aspects.renderAspectList();

            const list = document.getElementById('aspect-list');
            const items = list.querySelectorAll('.aspect-item');

            expect(items.length).toBe(2);

            // Check active class
            expect(items[0].classList.contains('active')).toBe(true);
            expect(items[1].classList.contains('active')).toBe(false);

            // Check content
            expect(items[0].querySelector('.aspect-name').textContent).toBe('Aspect 1');

            // Check add button
            const addBtn = document.getElementById('add-aspect-btn');
            expect(addBtn).not.toBeNull();
            expect(addBtn.innerText).toBe('+ New Aspect');
        });
    });

    describe('create aspect functions', () => {
        beforeEach(() => {
            document.body.innerHTML += `
                <div id="create-aspect-modal" class="hidden"></div>
                <img id="create-aspect-icon-preview" />
                <div id="create-aspect-icon-filename"></div>
                <input id="create-aspect-name-input" value="Test Name" />
                <textarea id="create-aspect-desc-input">Test Desc</textarea>
            `;
            state.aspects = [];
        });

        it('should upload create icon', () => {
            const file = new File([''], 'test-icon.png', { type: 'image/png' });
            const event = { target: { files: [file] } };
            
            // Mock FileReader
            const originalFileReader = global.FileReader;
            global.FileReader = vi.fn().mockImplementation(function() {
                this.readAsDataURL = vi.fn(function() {
                    this.onload({ target: { result: 'data:image/png;base64,mock' } });
                });
            });
            
            aspects.uploadCreateIcon(event);
            
            expect(window.tempCreateIcon).toBe('data:image/png;base64,mock');
            expect(document.getElementById('create-aspect-icon-filename').innerText).toBe('test-icon.png');
            
            global.FileReader = originalFileReader;
        });

        it('should accept create aspect from template', async () => {
            // Execute template creation
            aspects.acceptCreateAspectFromTemplate('blank');
            
            // Wait for dynamic import promise
            await new Promise(r => setTimeout(r, 10));
            
            expect(state.aspects.length).toBeGreaterThan(0);
            expect(state.aspects[0].name).toBe('New Aspect');
            expect(ui.showEditorView).toHaveBeenCalled();
            expect(ui.markChangesUnsaved).toHaveBeenCalled();
        });

        it('should accept create aspect', () => {
            window.tempCreateIcon = 'data:image/png;base64,mock';
            aspects.acceptCreateAspect();
            
            expect(state.aspects.length).toBe(1);
            expect(state.aspects[0].name).toBe('Test Name');
            expect(state.aspects[0].description).toBe('Test Desc');
            expect(state.aspects[0].icon).toBe('data:image/png;base64,mock');
            expect(ui.showEditorView).toHaveBeenCalled();
            expect(ui.markChangesUnsaved).toHaveBeenCalled();
        });
    });
});
