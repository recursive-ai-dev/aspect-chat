import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { state } from '../src/js/modules/state.js';
import { loadDefaultAspects } from '../src/js/modules/aspects.js';
import * as ui from '../src/js/modules/ui.js';

describe('Aspects Management', () => {
    beforeEach(() => {
        // Reset state
        state.aspects = [];
        state.currentAspectId = null;

        // Clear localStorage
        localStorage.clear();

        // Mock DOM elements required by renderAspectList, applyAspectBackground, showChatView
        document.body.innerHTML = `
            <div id="aspect-list"></div>
            <div id="editor-view"></div>
            <div id="chat-view"></div>
            <img id="chat-aspect-icon" />
            <div id="chat-aspect-name"></div>
            <div id="chat-aspect-desc"></div>
            <div id="tools-dropdown"></div>
            <div id="chat-messages"></div>
        `;

        // Mock ui functions used in loadDefaultAspects that might manipulate DOM not fully set up
        vi.spyOn(ui, 'applyAspectBackground').mockImplementation(() => {});
        vi.spyOn(ui, 'showChatView').mockImplementation(() => {});

        // Suppress console.error so it doesn't clutter test output
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should handle malformed JSON in localStorage during loadDefaultAspects', () => {
        // Setup bad JSON
        localStorage.setItem('aspects_data', '{ bad json }');

        // Call the function
        loadDefaultAspects();

        // Verification
        // If it throws, the test will fail.
        // If it handles the error gracefully, it should create the Studio Guide default.
        expect(state.aspects.length).toBe(1);
        expect(state.aspects[0].id).toBe('studio-guide');
        expect(console.error).toHaveBeenCalled();
    });
});
