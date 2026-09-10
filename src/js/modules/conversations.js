/**
 * Conversation model.
 *
 * Each Aspect owns a list of named conversations. Exactly one is active at a
 * time, and `aspect.chatHistory` is kept as the *same array reference* as the
 * active conversation's `messages`. That keeps every existing call site
 * (`aspect.chatHistory.push(...)`, splice, find) working unchanged while the
 * data underneath is per-conversation.
 *
 * Because `chatHistory` is a duplicate reference, it is stripped before
 * serialisation — see `serializeAspect` in persist.js.
 */

let idCounter = 0;

/** Collision-resistant id that stays sortable by creation time. */
export function newId(prefix = 'c') {
    idCounter = (idCounter + 1) % 100000;
    return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createConversation(messages = [], title = null) {
    const now = Date.now();
    return {
        id: newId('conv'),
        title: title || 'New chat',
        createdAt: now,
        updatedAt: now,
        messages
    };
}

/**
 * Derive a conversation title from its first user message.
 * Falls back to the first assistant message so a template's greeting still
 * produces something better than "New chat".
 */
export function deriveTitle(messages) {
    const source =
        messages.find(m => m.role === 'user' && m.content && m.content.trim()) ||
        messages.find(m => m.role === 'assistant' && m.content && m.content.trim());
    if (!source) return 'New chat';

    const firstLine = String(source.content)
        .replace(/```[\s\S]*?```/g, ' ')     // drop code blocks
        .replace(/\[Run Tool:[^\]]*\]/g, ' ') // drop tool tags
        .replace(/[#*_>`]/g, '')              // drop markdown punctuation
        .replace(/\s+/g, ' ')
        .trim();

    if (!firstLine) return 'New chat';
    return firstLine.length > 48 ? firstLine.slice(0, 45).trimEnd() + '…' : firstLine;
}

/**
 * Give an aspect a valid conversation list and bind `chatHistory` to the
 * active one. Safe to call repeatedly; it is the single place that upgrades a
 * legacy single-`chatHistory` aspect to the conversation model.
 */
export function normalizeConversations(aspect) {
    if (!aspect) return aspect;

    if (!Array.isArray(aspect.conversations) || aspect.conversations.length === 0) {
        // Legacy shape: one flat chatHistory becomes conversation number one.
        const legacy = Array.isArray(aspect.chatHistory) ? aspect.chatHistory : [];
        const conv = createConversation(legacy);
        conv.title = deriveTitle(legacy);
        aspect.conversations = [conv];
        aspect.activeConversationId = conv.id;
    }

    // Repair any conversation missing required fields (hand-edited or partial imports).
    aspect.conversations.forEach(conv => {
        if (!conv.id) conv.id = newId('conv');
        if (!Array.isArray(conv.messages)) conv.messages = [];
        if (!conv.title) conv.title = deriveTitle(conv.messages);
        if (!conv.createdAt) conv.createdAt = Date.now();
        if (!conv.updatedAt) conv.updatedAt = conv.createdAt;
    });

    const active = aspect.conversations.find(c => c.id === aspect.activeConversationId);
    const target = active || aspect.conversations[0];
    aspect.activeConversationId = target.id;
    // Shared reference, not a copy — mutations through either name reach both.
    aspect.chatHistory = target.messages;

    return aspect;
}

export function getActiveConversation(aspect) {
    if (!aspect) return null;
    normalizeConversations(aspect);
    return aspect.conversations.find(c => c.id === aspect.activeConversationId) || null;
}

/** Start a new conversation and make it active. Returns it. */
export function startConversation(aspect, initialMessages = []) {
    normalizeConversations(aspect);
    const conv = createConversation(initialMessages.slice());
    aspect.conversations.unshift(conv);
    aspect.activeConversationId = conv.id;
    aspect.chatHistory = conv.messages;
    return conv;
}

/** Switch the active conversation. Returns true when the id was found. */
export function switchConversation(aspect, conversationId) {
    normalizeConversations(aspect);
    const conv = aspect.conversations.find(c => c.id === conversationId);
    if (!conv) return false;
    aspect.activeConversationId = conv.id;
    aspect.chatHistory = conv.messages;
    return true;
}

/**
 * Delete a conversation. An Aspect always keeps at least one, so deleting the
 * last remaining conversation replaces it with a fresh empty one rather than
 * leaving the aspect in an unrenderable state.
 */
export function deleteConversation(aspect, conversationId) {
    normalizeConversations(aspect);
    const index = aspect.conversations.findIndex(c => c.id === conversationId);
    if (index === -1) return false;

    aspect.conversations.splice(index, 1);

    if (aspect.conversations.length === 0) {
        // Build the replacement directly rather than via startConversation():
        // that path re-normalises first, and an empty list makes normalisation
        // rebuild one from the stale chatHistory alias, leaving two.
        const replacement = createConversation([]);
        aspect.conversations.push(replacement);
        aspect.activeConversationId = replacement.id;
        aspect.chatHistory = replacement.messages;
        return true;
    }

    if (aspect.activeConversationId === conversationId) {
        const next = aspect.conversations[Math.min(index, aspect.conversations.length - 1)];
        aspect.activeConversationId = next.id;
        aspect.chatHistory = next.messages;
    }
    return true;
}

export function renameConversation(aspect, conversationId, title) {
    normalizeConversations(aspect);
    const conv = aspect.conversations.find(c => c.id === conversationId);
    if (!conv) return false;
    const clean = (title || '').trim();
    conv.title = clean || deriveTitle(conv.messages);
    conv.titleLocked = Boolean(clean);
    conv.updatedAt = Date.now();
    return true;
}

/**
 * Record activity on the active conversation: bump its timestamp and, while it
 * is still untitled, keep its title in sync with the opening message.
 */
export function touchActiveConversation(aspect) {
    const conv = getActiveConversation(aspect);
    if (!conv) return;
    conv.updatedAt = Date.now();
    if (!conv.titleLocked && (conv.title === 'New chat' || !conv.title)) {
        conv.title = deriveTitle(conv.messages);
    }
}

/** Mark a title as user-chosen so auto-titling stops overwriting it. */
export function lockConversationTitle(aspect, conversationId, locked = true) {
    const conv = aspect.conversations?.find(c => c.id === conversationId);
    if (conv) conv.titleLocked = Boolean(locked);
}

/** Conversations newest-activity-first, for list rendering. */
export function sortedConversations(aspect) {
    normalizeConversations(aspect);
    return aspect.conversations.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
