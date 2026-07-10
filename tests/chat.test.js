import { describe, it, expect } from 'vitest';
import { escapeHtml } from '../src/js/modules/chat.js';

describe('escapeHtml', () => {
    it('should not modify a string without special characters', () => {
        expect(escapeHtml('Hello World')).toBe('Hello World');
    });

    it('should escape ampersands', () => {
        expect(escapeHtml('Salt & Pepper')).toBe('Salt &amp; Pepper');
    });

    it('should escape less than signs', () => {
        expect(escapeHtml('5 < 10')).toBe('5 &lt; 10');
    });

    it('should escape greater than signs', () => {
        expect(escapeHtml('10 > 5')).toBe('10 &gt; 5');
    });

    it('should escape double quotes', () => {
        expect(escapeHtml('He said "Hello"')).toBe('He said &quot;Hello&quot;');
    });

    it('should escape single quotes', () => {
        expect(escapeHtml("It's a sunny day")).toBe('It&#039;s a sunny day');
    });

    it('should escape a combination of special characters', () => {
        expect(escapeHtml('<script>alert("XSS & fun\'s")</script>'))
            .toBe('&lt;script&gt;alert(&quot;XSS &amp; fun&#039;s&quot;)&lt;/script&gt;');
    });

    it('should handle an empty string', () => {
        expect(escapeHtml('')).toBe('');
    });

    it('should handle a string with only special characters', () => {
        expect(escapeHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#039;');
    });
});
