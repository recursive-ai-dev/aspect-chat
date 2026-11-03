import { describe, it, expect } from 'vitest';
import {
    newId,
    createConversation,
    deriveTitle,
    normalizeConversations,
    getActiveConversation,
    startConversation,
    switchConversation,
    deleteConversation,
    renameConversation,
    touchActiveConversation,
    lockConversationTitle,
    sortedConversations
} from '../src/js/modules/conversations.js';

describe('newId', () => {
    it('produces unique ids even when generated in the same millisecond', () => {
        const ids = new Set(Array.from({ length: 500 }, () => newId('conv')));
        expect(ids.size).toBe(500);
    });
});

describe('deriveTitle', () => {
    it('uses the first user message', () => {
        expect(deriveTitle([
            { role: 'assistant', content: 'Hello!' },
            { role: 'user', content: 'Explain closures' }
        ])).toBe('Explain closures');
    });

    it('falls back to the assistant greeting when there is no user turn yet', () => {
        expect(deriveTitle([{ role: 'assistant', content: 'Welcome aboard' }])).toBe('Welcome aboard');
    });

    it('strips code blocks, tool tags and markdown punctuation', () => {
        const title = deriveTitle([{ role: 'user', content: '## **Fix** this\n```js\nconst x = 1;\n```\n[Run Tool: A.js]' }]);
        expect(title).toBe('Fix this');
    });

    it('truncates long titles with an ellipsis', () => {
        const title = deriveTitle([{ role: 'user', content: 'x'.repeat(200) }]);
        expect(title.length).toBeLessThanOrEqual(48);
        expect(title.endsWith('…')).toBe(true);
    });

    it('falls back to a placeholder for empty input', () => {
        expect(deriveTitle([])).toBe('New chat');
        expect(deriveTitle([{ role: 'user', content: '   ' }])).toBe('New chat');
        expect(deriveTitle([{ role: 'system', content: 'log line' }])).toBe('New chat');
    });
});

describe('normalizeConversations', () => {
    it('upgrades a legacy flat chatHistory into one conversation', () => {
        const aspect = { chatHistory: [{ role: 'user', content: 'Legacy message' }] };
        normalizeConversations(aspect);

        expect(aspect.conversations).toHaveLength(1);
        expect(aspect.conversations[0].title).toBe('Legacy message');
        expect(aspect.activeConversationId).toBe(aspect.conversations[0].id);
    });

    it('keeps chatHistory as the SAME array as the active conversation', () => {
        // This identity is what lets every existing call site keep using
        // aspect.chatHistory.push(...) unchanged.
        const aspect = { chatHistory: [] };
        normalizeConversations(aspect);

        aspect.chatHistory.push({ role: 'user', content: 'via alias' });
        expect(aspect.conversations[0].messages).toHaveLength(1);
        expect(aspect.conversations[0].messages).toBe(aspect.chatHistory);
    });

    it('is idempotent', () => {
        const aspect = { chatHistory: [{ role: 'user', content: 'One' }] };
        normalizeConversations(aspect);
        const firstId = aspect.conversations[0].id;
        normalizeConversations(aspect);
        normalizeConversations(aspect);

        expect(aspect.conversations).toHaveLength(1);
        expect(aspect.conversations[0].id).toBe(firstId);
    });

    it('repairs conversations missing required fields', () => {
        const aspect = { conversations: [{ messages: [{ role: 'user', content: 'Hi' }] }] };
        normalizeConversations(aspect);

        const conv = aspect.conversations[0];
        expect(conv.id).toBeTruthy();
        expect(conv.title).toBe('Hi');
        expect(conv.createdAt).toBeTruthy();
        expect(conv.updatedAt).toBeTruthy();
    });

    it('recovers from an activeConversationId pointing at a deleted chat', () => {
        const aspect = {
            conversations: [createConversation([], 'Only one')],
            activeConversationId: 'gone'
        };
        normalizeConversations(aspect);
        expect(aspect.activeConversationId).toBe(aspect.conversations[0].id);
        expect(aspect.chatHistory).toBe(aspect.conversations[0].messages);
    });

    it('tolerates null', () => {
        expect(normalizeConversations(null)).toBeNull();
    });

    it('repairs malformed imports and duplicate ids while retaining tool metadata', () => {
        const aspect = { conversations: [null, [], 3, {
            id: 'duplicate', title: {}, createdAt: -1, updatedAt: Infinity,
            messages: [null, { role: 'user', content: 42 }, { role: 'user', content: 'Readable' },
                { role: 'assistant', content: null, tool_calls: [{ id: 'call-1' }] }]
        }, { id: 'duplicate', messages: 'bad' }] };
        normalizeConversations(aspect);
        expect(aspect.conversations).toHaveLength(2);
        expect(new Set(aspect.conversations.map(c => c.id)).size).toBe(2);
        const first = aspect.conversations[0];
        expect(first.title).toBe('Readable');
        expect(first.createdAt).toBeGreaterThan(0);
        expect(Number.isFinite(first.updatedAt)).toBe(true);
        expect(first.messages).toEqual([{ role: 'user', content: 'Readable' }, { role: 'assistant', content: '', tool_calls: [{ id: 'call-1' }] }]);
    });

    it('maintains normalization invariants for 500 deterministic adversarial records (seed 0x51a7)', () => {
        let seed = 0x51a7;
        const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
        const values = [null, [], 12, 'text', {}, { role: 'user', content: 4 }, { role: 'assistant', content: 'Hi' }];
        for (let i = 0; i < 500; i++) {
            const aspect = { conversations: Array.from({ length: next() % 6 }, () =>
                next() % 2 ? structuredClone(values[next() % values.length]) : {
                    id: 'duplicate', title: values[next() % values.length],
                    messages: Array.from({ length: next() % 8 }, () => structuredClone(values[next() % values.length]))
                }) };
            normalizeConversations(aspect);
            expect(aspect.conversations.length).toBeGreaterThan(0);
            expect(new Set(aspect.conversations.map(c => c.id)).size).toBe(aspect.conversations.length);
            expect(aspect.chatHistory).toBe(aspect.conversations.find(c => c.id === aspect.activeConversationId).messages);
            const first = JSON.stringify(aspect);
            normalizeConversations(aspect);
            expect(JSON.stringify(aspect)).toBe(first);
        }
    });
});

describe('conversation lifecycle', () => {
    it('starts a new conversation, makes it active and rebinds chatHistory', () => {
        const aspect = { chatHistory: [{ role: 'user', content: 'First chat' }] };
        normalizeConversations(aspect);
        const original = aspect.conversations[0];

        const fresh = startConversation(aspect);

        expect(aspect.conversations).toHaveLength(2);
        expect(aspect.conversations[0]).toBe(fresh);  // newest first
        expect(aspect.activeConversationId).toBe(fresh.id);
        expect(aspect.chatHistory).toBe(fresh.messages);
        expect(aspect.chatHistory).toHaveLength(0);
        // The earlier conversation is untouched.
        expect(original.messages).toHaveLength(1);
    });

    it('switches between conversations without losing either', () => {
        const aspect = { chatHistory: [{ role: 'user', content: 'A' }] };
        normalizeConversations(aspect);
        const first = aspect.conversations[0];
        const second = startConversation(aspect);
        aspect.chatHistory.push({ role: 'user', content: 'B' });

        expect(switchConversation(aspect, first.id)).toBe(true);
        expect(aspect.chatHistory[0].content).toBe('A');

        expect(switchConversation(aspect, second.id)).toBe(true);
        expect(aspect.chatHistory[0].content).toBe('B');

        expect(switchConversation(aspect, 'nonexistent')).toBe(false);
    });

    it('deleting the active conversation selects a neighbour', () => {
        const aspect = { chatHistory: [] };
        normalizeConversations(aspect);
        startConversation(aspect);
        const active = startConversation(aspect);

        expect(aspect.conversations).toHaveLength(3);
        deleteConversation(aspect, active.id);

        expect(aspect.conversations).toHaveLength(2);
        expect(aspect.activeConversationId).not.toBe(active.id);
        expect(aspect.chatHistory).toBe(
            aspect.conversations.find(c => c.id === aspect.activeConversationId).messages
        );
    });

    it('deleting the last conversation leaves a fresh empty one', () => {
        // An Aspect with zero conversations would be unrenderable.
        const aspect = { chatHistory: [{ role: 'user', content: 'Only' }] };
        normalizeConversations(aspect);

        deleteConversation(aspect, aspect.conversations[0].id);

        expect(aspect.conversations).toHaveLength(1);
        expect(aspect.chatHistory).toHaveLength(0);
        expect(aspect.chatHistory).toBe(aspect.conversations[0].messages);
    });

    it('reports an unknown id rather than deleting something else', () => {
        const aspect = { chatHistory: [] };
        normalizeConversations(aspect);
        expect(deleteConversation(aspect, 'nope')).toBe(false);
        expect(aspect.conversations).toHaveLength(1);
    });

    it('renames a conversation and falls back to a derived title when blanked', () => {
        const aspect = { chatHistory: [{ role: 'user', content: 'Derived name' }] };
        normalizeConversations(aspect);
        const id = aspect.conversations[0].id;

        renameConversation(aspect, id, '  Custom name  ');
        expect(aspect.conversations[0].title).toBe('Custom name');
        expect(aspect.conversations[0].titleLocked).toBe(true);

        renameConversation(aspect, id, '   ');
        expect(aspect.conversations[0].title).toBe('Derived name');
        expect(aspect.conversations[0].titleLocked).toBe(false);

        lockConversationTitle(aspect, id, true);
        expect(aspect.conversations[0].titleLocked).toBe(true);
        lockConversationTitle(aspect, id, false);
        expect(aspect.conversations[0].titleLocked).toBe(false);
    });
});

describe('auto-titling', () => {
    it('titles an untitled conversation from its first message', () => {
        const aspect = { chatHistory: [] };
        normalizeConversations(aspect);
        expect(getActiveConversation(aspect).title).toBe('New chat');

        aspect.chatHistory.push({ role: 'user', content: 'Refactor the parser' });
        touchActiveConversation(aspect);

        expect(getActiveConversation(aspect).title).toBe('Refactor the parser');
    });

    it('never overwrites a title the user chose', () => {
        const aspect = { chatHistory: [] };
        normalizeConversations(aspect);
        const id = aspect.activeConversationId;

        renameConversation(aspect, id, 'My name for this');
        lockConversationTitle(aspect, id);

        aspect.chatHistory.push({ role: 'user', content: 'Something else entirely' });
        touchActiveConversation(aspect);

        expect(getActiveConversation(aspect).title).toBe('My name for this');
    });
});

describe('sortedConversations', () => {
    it('orders by most recent activity without mutating the stored order', () => {
        const aspect = { chatHistory: [] };
        normalizeConversations(aspect);
        const first = aspect.conversations[0];
        const second = startConversation(aspect);

        first.updatedAt = 5000;
        second.updatedAt = 1000;

        const sorted = sortedConversations(aspect);
        expect(sorted[0]).toBe(first);
        expect(sorted[1]).toBe(second);
        // The underlying array keeps its own order.
        expect(aspect.conversations[0]).toBe(second);
    });
});
