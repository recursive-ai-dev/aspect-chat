import { describe, expect, it, vi } from 'vitest';
import { renderMarkdown } from '../src/js/modules/chat.js';

vi.mock('../src/js/modules/aspects.js', () => ({ getCurrentAspect: vi.fn() }));
vi.mock('../src/js/modules/ui.js', () => ({ markChangesUnsaved: vi.fn() }));
vi.mock('../src/js/modules/tools.js', () => ({ sendAIRequest: vi.fn() }));

describe('untrusted Markdown after sanitizer dependency upgrades', () => {
    it.each([
        '<img src=x onerror="alert(1)"><script>alert(1)</script>',
        '<svg><g/onload=alert(1)//<p>',
        '<math><mi xlink:href="data:x,<script>alert(1)</script>">x</mi></math>',
        '<form><math><mtext></form><form><mglyph><style></math><img src=x onerror="alert(1)">',
        '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
        '<a href="java&#x09;script:alert(1)" data-action="storage-fresh" id="send-btn" style="position:fixed">x</a>',
    ])('remains inert after browser HTML reparsing: %s', payload => {
        const rendered = document.createElement('div');
        rendered.innerHTML = renderMarkdown(payload);
        expect(rendered.querySelector('script,svg,math,form,iframe,object,embed,style')).toBeNull();
        for (const element of rendered.querySelectorAll('*')) {
            for (const { name, value } of element.attributes) {
                expect(name).not.toMatch(/^on|^data-|^style$|^id$/i);
                if (['href', 'src', 'xlink:href'].includes(name)) expect(value.replace(/\s/g, '')).not.toMatch(/^(?:javascript:|data:text\/html)/i);
            }
        }
    });

    it('preserves useful Markdown and safe link isolation', () => {
        const rendered = document.createElement('div');
        rendered.innerHTML = renderMarkdown('**Safe** [link](https://example.com) and `<script>`');
        expect(rendered.querySelector('strong').textContent).toBe('Safe');
        expect(rendered.querySelector('code').textContent).toBe('<script>');
        expect(rendered.querySelector('a').getAttribute('rel')).toBe('noopener noreferrer');
        expect(rendered.querySelector('a').getAttribute('target')).toBe('_blank');
    });
});
