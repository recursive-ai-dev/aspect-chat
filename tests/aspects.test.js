import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { state } from '../src/js/modules/state.js';
import { loadDefaultAspects } from '../src/js/modules/aspects.js';
import * as ui from '../src/js/modules/ui.js';
import * as aspects from '../src/js/modules/aspects.js';

vi.mock('../src/js/modules/ui.js', () => ({
    applyAspectBackground: vi.fn(),
    showChatView: vi.fn(),
    showEditorView: vi.fn(),
    markChangesUnsaved: vi.fn(),
}));

vi.mock('../src/js/modules/state.js', async (importOriginal) => {
    const mod = await importOriginal();
    return {
        ...mod,
        saveAspectsToLocalStorage: vi.fn(),
    };
});

describe('Aspects Management', () => {

describe('Aspects Module', () => {
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
});
});