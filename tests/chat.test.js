import { describe, it, expect, vi, beforeEach } from 'vitest';
import { escapeHtml, deleteMessage } from '../src/js/modules/chat.js';
import * as aspects from '../src/js/modules/aspects.js';
import * as ui from '../src/js/modules/ui.js';

vi.mock('../src/js/modules/aspects.js', () => ({
    getCurrentAspect: vi.fn()
}));

vi.mock('../src/js/modules/ui.js', () => ({
    markChangesUnsaved: vi.fn()
}));

// Mock tools.js so import in chat.js doesn't fail
vi.mock('../src/js/modules/tools.js', () => ({
    sendAIRequest: vi.fn()
}));

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

describe('deleteMessage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = '<div id="chat-messages"></div>';
    });

    it('should delete a message at the given index and update UI', () => {
        const mockAspect = {
            chatHistory: [
                { role: 'user', content: 'msg 1' },
                { role: 'assistant', content: 'msg 2' },
                { role: 'user', content: 'msg 3' }
            ]
        };
        aspects.getCurrentAspect.mockReturnValue(mockAspect);

        deleteMessage(1);

        expect(mockAspect.chatHistory.length).toBe(2);
        expect(mockAspect.chatHistory[0].content).toBe('msg 1');
        expect(mockAspect.chatHistory[1].content).toBe('msg 3');
        expect(ui.markChangesUnsaved).toHaveBeenCalled();

        const chatMessages = document.getElementById('chat-messages');
        expect(chatMessages.children.length).toBe(2);
    });

    it('should return early if getCurrentAspect returns null', () => {
        aspects.getCurrentAspect.mockReturnValue(null);

        deleteMessage(0);

        expect(ui.markChangesUnsaved).not.toHaveBeenCalled();
    });

    it('should return early if aspect has no chatHistory', () => {
        aspects.getCurrentAspect.mockReturnValue({});

        deleteMessage(0);

        expect(ui.markChangesUnsaved).not.toHaveBeenCalled();
    });
});
