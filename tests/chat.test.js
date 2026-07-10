import { describe, it, expect } from 'vitest';
import { escapeHtml } from '../src/js/modules/chat.js';

describe('chat module', () => {
    describe('escapeHtml', () => {
        it('should escape &', () => {
            expect(escapeHtml('&')).toBe('&amp;');
        });

        it('should escape < and >', () => {
            expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
        });

        it('should escape "', () => {
            expect(escapeHtml('"test"')).toBe('&quot;test&quot;');
        });

        it('should escape \'', () => {
            expect(escapeHtml("'test'")).toBe('&#039;test&#039;');
        });

        it('should handle strings with multiple characters to escape', () => {
            expect(escapeHtml('<a href="test&me">\'click\'</a>'))
                .toBe('&lt;a href=&quot;test&amp;me&quot;&gt;&#039;click&#039;&lt;/a&gt;');
        });

        it('should return the same string if there are no characters to escape', () => {
            expect(escapeHtml('hello world')).toBe('hello world');
        });

        it('should handle empty strings', () => {
            expect(escapeHtml('')).toBe('');
        });
    });
});
