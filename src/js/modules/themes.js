/**
 * Named colour themes.
 *
 * Each theme is a palette of CSS custom properties defined in `main.css` under
 * `body.<cls>` (and `body.dark-theme` for dark ones, so the scattered
 * `.dark-theme` component tweaks keep applying). This module only decides which
 * classes go on <body>.
 */

export const THEMES = [
    { id: 'warm-light', label: 'Parchment · light', dark: false, cls: '' },
    { id: 'slate',      label: 'Slate · light',     dark: false, cls: 'theme-slate' },
    { id: 'sepia',      label: 'Sepia · light',     dark: false, cls: 'theme-sepia' },
    { id: 'warm-dark',  label: 'Redwood · dark',    dark: true,  cls: '' },
    { id: 'midnight',   label: 'Midnight · dark',   dark: true,  cls: 'theme-midnight' },
    { id: 'forest',     label: 'Forest · dark',     dark: true,  cls: 'theme-forest' }
];

export const DEFAULT_THEME = 'warm-light';

const THEME_CLASSES = THEMES.map(t => t.cls).filter(Boolean);

export function getTheme(id) {
    return THEMES.find(t => t.id === id) || THEMES[0];
}

/** Resolve the stored theme, migrating the old boolean `darkMode` flag. */
export function readStoredTheme() {
    if (typeof localStorage === 'undefined') return DEFAULT_THEME;
    const explicit = localStorage.getItem('theme');
    if (explicit && THEMES.some(t => t.id === explicit)) return explicit;
    return localStorage.getItem('darkMode') === 'true' ? 'warm-dark' : DEFAULT_THEME;
}

/** Put the right classes on <body> for `id`. Safe to call before/after paint. */
export function applyTheme(id, { persist = false } = {}) {
    const body = typeof document !== 'undefined' && document.body;
    if (!body) return;
    const theme = getTheme(id);
    body.classList.remove('dark-theme', ...THEME_CLASSES);
    if (theme.dark) body.classList.add('dark-theme');
    if (theme.cls) body.classList.add(theme.cls);
    body.dataset.theme = theme.id;
    if (persist && typeof localStorage !== 'undefined') {
        try {
            localStorage.setItem('theme', theme.id);
            localStorage.setItem('darkMode', String(theme.dark));
        } catch { /* storage full or private mode */ }
    }
}

/** Fill a <select> with the theme catalogue. */
export function populateThemeSelect(select, current) {
    if (!select) return;
    select.innerHTML = '';
    THEMES.forEach(theme => {
        const opt = document.createElement('option');
        opt.value = theme.id;
        opt.textContent = theme.label;
        select.appendChild(opt);
    });
    select.value = current && THEMES.some(t => t.id === current) ? current : DEFAULT_THEME;
}
