import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as chatModule from '../src/js/modules/chat.js';
import * as aspects from '../src/js/modules/aspects.js';
import * as ui from '../src/js/modules/ui.js';
import * as tools from '../src/js/modules/tools.js';

vi.mock('../src/js/modules/aspects.js', () => ({
    getCurrentAspect: vi.fn()
}));

vi.mock('../src/js/modules/ui.js', () => ({
    markChangesUnsaved: vi.fn()
}));

vi.mock('../src/js/modules/tools.js', () => ({
    sendAIRequest: vi.fn().mockResolvedValue()
}));

describe('escapeHtml', () => {
    it('should escape special characters', () => {
        expect(chatModule.escapeHtml('<script>')).toBe('&lt;script&gt;');
    });
});

describe('renderMarkdown hardening', () => {
    it('strips data-* attributes so injected [data-action] cannot reach the click delegate', () => {
        const html = chatModule.renderMarkdown('<a href="#" data-action="storage-fresh">x</a>');
        expect(html).not.toMatch(/data-action/);
    });

    it('drops style and id attributes (clickjack overlay / id shadowing)', () => {
        const html = chatModule.renderMarkdown('<a href="#" style="position:fixed;inset:0" id="send-btn">x</a>');
        expect(html).not.toMatch(/style=/);
        expect(html).not.toMatch(/id=/);
    });

    it('removes form controls', () => {
        const html = chatModule.renderMarkdown('<button>go</button><input><textarea></textarea>');
        expect(html).not.toMatch(/<button|<input|<textarea/i);
    });

    it('forces links to open out-of-frame with rel=noopener', () => {
        const html = chatModule.renderMarkdown('[x](https://example.com)');
        expect(html).toMatch(/rel="noopener noreferrer"/);
        expect(html).toMatch(/target="_blank"/);
    });

    it('still drops javascript: URLs', () => {
        const html = chatModule.renderMarkdown('<a href="javascript:alert(1)">x</a>');
        expect(html).not.toMatch(/javascript:/i);
    });
});

describe('editMessage, cancelEdit, submitEdit', () => {
    beforeEach(() => {
        document.body.innerHTML = '<div id="chat-messages"></div>';
    });

    it('should enable edit mode on user message', () => {
        const aspect = { chatHistory: [{ role: 'user', content: 'hello' }] };
        aspects.getCurrentAspect.mockReturnValue(aspect);
        
        chatModule.editMessage(0);
        expect(aspect.chatHistory[0]._isEditing).toBe(true);
        expect(ui.markChangesUnsaved).not.toHaveBeenCalled(); // Edit mode doesn't save yet
    });

    it('should cancel edit mode', () => {
        const aspect = { chatHistory: [{ role: 'user', content: 'hello', _isEditing: true }] };
        aspects.getCurrentAspect.mockReturnValue(aspect);
        
        chatModule.cancelEdit(0);
        expect(aspect.chatHistory[0]._isEditing).toBeUndefined();
    });

    it('should submit edit and truncate history', async () => {
        const aspect = { 
            chatHistory: [
                { role: 'user', content: 'hello', _isEditing: true },
                { role: 'assistant', content: 'hi' }
            ] 
        };
        aspects.getCurrentAspect.mockReturnValue(aspect);
        
        await chatModule.submitEdit(0, 'hello there');
        expect(aspect.chatHistory[0]._isEditing).toBeUndefined();
        expect(aspect.chatHistory[0].content).toBe('hello there');
        expect(aspect.chatHistory.length).toBe(1); // Truncates after
        expect(ui.markChangesUnsaved).toHaveBeenCalled();
        expect(tools.sendAIRequest).toHaveBeenCalled();
    });
    
    it('should handle missing aspect for edit functions', () => {
        aspects.getCurrentAspect.mockReturnValue(null);
        chatModule.editMessage(0);
        chatModule.cancelEdit(0);
        chatModule.submitEdit(0, 'new');
        // Shouldn't throw
    });
});

describe('Chat UI Interactions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = `
            <div id="chat-messages"></div>
            <div id="tools-dropdown"></div>
        `;
    });

    describe('renderChatMessages', () => {
        it('should return early if no aspect or history', () => {
            aspects.getCurrentAspect.mockReturnValue(null);
            chatModule.renderChatMessages();
            expect(document.getElementById('chat-messages').innerHTML).toBe('');
        });

        it('should render system, user, and assistant messages', () => {
            aspects.getCurrentAspect.mockReturnValue({
                chatHistory: [
                    { role: 'system', content: 'Sys log' },
                    { role: 'user', content: 'Hello' },
                    { role: 'assistant', content: 'Hi' }
                ]
            });
            chatModule.renderChatMessages();
            const container = document.getElementById('chat-messages');
            expect(container.children.length).toBe(3);
            expect(container.children[0]).toHaveClass('system-log');
            expect(container.children[1]).toHaveClass('user');
            expect(container.children[2]).toHaveClass('assistant');
        });

        it('should render inline editor if _isEditing is true', () => {
            aspects.getCurrentAspect.mockReturnValue({
                chatHistory: [
                    { role: 'user', content: 'Hello', _isEditing: true }
                ]
            });
            chatModule.renderChatMessages();
            const container = document.getElementById('chat-messages');
            expect(container.querySelector('.inline-editor-container')).not.toBeNull();
            expect(container.querySelector('.inline-editor-textarea').value).toBe('Hello');
            
            // Test cancel btn click handler
            const cancelBtn = container.querySelector('.danger-btn');
            cancelBtn.onclick();
            expect(aspects.getCurrentAspect().chatHistory[0]._isEditing).toBeUndefined();

            // Test save btn click handler by re-rendering to get new button
            aspects.getCurrentAspect().chatHistory[0]._isEditing = true;
            chatModule.renderChatMessages();
            const saveBtn = container.querySelector('.save-btn');
            saveBtn.onclick();
            expect(aspects.getCurrentAspect().chatHistory[0].content).toBe('Hello');
        });
        
        it('should offer the right actions per role and act on the right message', () => {
            const aspect = {
                name: 'A', description: '',
                chatHistory: [
                    { role: 'user', content: 'Hello' },
                    { role: 'assistant', content: 'Hi' }
                ]
            };
            aspects.getCurrentAspect.mockReturnValue(aspect);
            chatModule.renderChatMessages();

            const container = document.getElementById('chat-messages');
            const rows = container.querySelectorAll('.message-actions');
            expect(rows.length).toBe(2);

            const titles = row => Array.from(row.querySelectorAll('.msg-action-btn')).map(b => b.title);
            expect(titles(rows[0])).toEqual(['Copy message', 'Edit message', 'Delete message']);
            expect(titles(rows[1])).toEqual(['Copy message', 'Regenerate from here', 'Delete message']);

            // Handlers are rebound on every render, so index 0's delete must
            // remove the first message rather than a stale one.
            rows[0].querySelector('[title="Delete message"]').click();
            expect(aspect.chatHistory.length).toBe(1);
            expect(aspect.chatHistory[0].content).toBe('Hi');
        });

        it('shows an empty state instead of a blank pane for a new conversation', () => {
            aspects.getCurrentAspect.mockReturnValue({
                name: 'Fresh Aspect',
                description: 'Ready when you are.',
                chatHistory: []
            });
            chatModule.renderChatMessages();

            const empty = document.getElementById('chat-messages').querySelector('.chat-empty-state');
            expect(empty).not.toBeNull();
            expect(empty.textContent).toContain('Fresh Aspect');
            expect(empty.textContent).toContain('Ready when you are.');
        });
    });

    describe('deleteMessage', () => {
        it('should delete message at index', () => {
            const aspect = { chatHistory: [{ role: 'user', content: 'm1' }, { role: 'assistant', content: 'm2' }] };
            aspects.getCurrentAspect.mockReturnValue(aspect);
            chatModule.deleteMessage(0);
            expect(aspect.chatHistory.length).toBe(1);
            expect(aspect.chatHistory[0].content).toBe('m2');
            expect(ui.markChangesUnsaved).toHaveBeenCalled();
        });
        it('should return early if no aspect', () => {
            aspects.getCurrentAspect.mockReturnValue(null);
            chatModule.deleteMessage(0);
            expect(ui.markChangesUnsaved).not.toHaveBeenCalled();
        });
    });

    describe('regenerateMessage', () => {
        it('should splice history and send AI request', async () => {
            const aspect = { chatHistory: [{ role: 'user', content: '1' }, { role: 'assistant', content: '2' }, { role: 'user', content: '3' }] };
            aspects.getCurrentAspect.mockReturnValue(aspect);
            await chatModule.regenerateMessage(1);
            expect(aspect.chatHistory.length).toBe(1);
            expect(ui.markChangesUnsaved).toHaveBeenCalled();
            expect(tools.sendAIRequest).toHaveBeenCalled();
        });
        it('should return early if no aspect', async () => {
            aspects.getCurrentAspect.mockReturnValue(null);
            await chatModule.regenerateMessage(0);
            expect(ui.markChangesUnsaved).not.toHaveBeenCalled();
        });
    });

    describe('editMessage', () => {
        it('should set _isEditing to true for user message', () => {
            const aspect = { chatHistory: [{ role: 'user', content: 'm1' }] };
            aspects.getCurrentAspect.mockReturnValue(aspect);
            chatModule.editMessage(0);
            expect(aspect.chatHistory[0]._isEditing).toBe(true);
        });
        it('should ignore if not user message', () => {
            const aspect = { chatHistory: [{ role: 'assistant', content: 'm1' }] };
            aspects.getCurrentAspect.mockReturnValue(aspect);
            chatModule.editMessage(0);
            expect(aspect.chatHistory[0]._isEditing).toBeUndefined();
        });
    });

    describe('cancelEdit', () => {
        it('should remove _isEditing', () => {
            const aspect = { chatHistory: [{ role: 'user', content: 'm1', _isEditing: true }] };
            aspects.getCurrentAspect.mockReturnValue(aspect);
            chatModule.cancelEdit(0);
            expect(aspect.chatHistory[0]._isEditing).toBeUndefined();
        });
    });

    describe('submitEdit', () => {
        it('should update content, truncate history, and auto regenerate', () => {
            const aspect = { chatHistory: [{ role: 'user', content: 'm1', _isEditing: true }, { role: 'assistant', content: 'm2' }] };
            aspects.getCurrentAspect.mockReturnValue(aspect);
            chatModule.submitEdit(0, 'new m1');
            expect(aspect.chatHistory[0].content).toBe('new m1');
            expect(aspect.chatHistory[0]._isEditing).toBeUndefined();
            expect(aspect.chatHistory.length).toBe(1); // M2 truncated
            expect(ui.markChangesUnsaved).toHaveBeenCalled();
            expect(tools.sendAIRequest).toHaveBeenCalled();
        });
        it('should just render if content is empty or null', () => {
            const aspect = { chatHistory: [{ role: 'user', content: 'm1', _isEditing: true }] };
            aspects.getCurrentAspect.mockReturnValue(aspect);
            chatModule.submitEdit(0, '   ');
            expect(aspect.chatHistory[0].content).toBe('m1');
            expect(tools.sendAIRequest).not.toHaveBeenCalled();
        });
    });

    describe('Streaming bubbles', () => {
        it('should create and update streaming bubble', () => {
            const bubble = chatModule.createStreamingBubble();
            expect(bubble).toHaveClass('message-bubble');
            expect(bubble).toHaveClass('assistant');
            
            chatModule.updateStreamingBubble(bubble, 'New content', true);
            expect(bubble.innerHTML).toContain('New content');
        });
    });

    describe('toggleToolsDropdown', () => {
        it('should toggle class show', () => {
            const dropdown = document.getElementById('tools-dropdown');
            chatModule.toggleToolsDropdown();
            expect(dropdown.classList.contains('show')).toBe(true);
            chatModule.toggleToolsDropdown();
            expect(dropdown.classList.contains('show')).toBe(false);
        });
    });
});
