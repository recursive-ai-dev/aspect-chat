import { describe, it, expect, beforeEach } from 'vitest';
import { THEMES, DEFAULT_THEME, getTheme, readStoredTheme, applyTheme, populateThemeSelect } from '../src/js/modules/themes.js';

describe('themes', () => {
    beforeEach(() => {
        localStorage.clear();
        document.body.className = '';
        delete document.body.dataset.theme;
    });

    it('getTheme falls back to the first theme for an unknown id', () => {
        expect(getTheme('does-not-exist')).toBe(THEMES[0]);
        expect(getTheme('midnight').id).toBe('midnight');
    });

    it('readStoredTheme prefers an explicit stored theme', () => {
        localStorage.setItem('theme', 'forest');
        expect(readStoredTheme()).toBe('forest');
    });

    it('readStoredTheme migrates the legacy darkMode flag', () => {
        localStorage.setItem('darkMode', 'true');
        expect(readStoredTheme()).toBe('warm-dark');
    });

    it('readStoredTheme ignores an unknown stored theme and defaults', () => {
        localStorage.setItem('theme', 'chartreuse');
        expect(readStoredTheme()).toBe(DEFAULT_THEME);
    });

    it('applyTheme sets exactly the right body classes and data-theme', () => {
        applyTheme('midnight');
        expect(document.body.classList.contains('dark-theme')).toBe(true);
        expect(document.body.classList.contains('theme-midnight')).toBe(true);
        expect(document.body.dataset.theme).toBe('midnight');

        applyTheme('slate');
        expect(document.body.classList.contains('dark-theme')).toBe(false);
        expect(document.body.classList.contains('theme-midnight')).toBe(false);
        expect(document.body.classList.contains('theme-slate')).toBe(true);
        expect(document.body.dataset.theme).toBe('slate');

        applyTheme('warm-light');
        expect(document.body.className).toBe('');
        expect(document.body.dataset.theme).toBe('warm-light');
    });

    it('populateThemeSelect fills options and selects the current theme', () => {
        const select = document.createElement('select');
        populateThemeSelect(select, 'forest');
        expect(select.options.length).toBe(THEMES.length);
        expect(select.value).toBe('forest');

        populateThemeSelect(select, 'nonsense');
        expect(select.value).toBe(DEFAULT_THEME);
    });
});
