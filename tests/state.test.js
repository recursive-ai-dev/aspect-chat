import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { state, markChangesSaved } from '../src/js/modules/state.js';
import { markChangesUnsaved } from '../src/js/modules/ui.js';

describe('State Management', () => {
    beforeEach(() => {
        state.hasUnsavedChanges = false;
        // Mock DOM elements
        document.body.innerHTML = `
            <div id="save-reminder"></div>
            <button id="sidebar-save-btn"></button>
        `;
    });

    it('should initially have no unsaved changes', () => {
        expect(state.hasUnsavedChanges).toBe(false);
    });

    it('should mark changes as unsaved', () => {
        markChangesUnsaved();
        expect(state.hasUnsavedChanges).toBe(true);
        expect(document.getElementById('save-reminder').classList.contains('hidden')).toBe(false);
    });

    it('should mark changes as saved', () => {
        markChangesUnsaved(); // first make it true
        markChangesSaved();
        expect(state.hasUnsavedChanges).toBe(false);
        expect(document.getElementById('save-reminder').classList.contains('hidden')).toBe(true);
    });
});
