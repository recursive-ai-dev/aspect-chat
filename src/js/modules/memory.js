/** Session-only (~) keys never cross a persistence or export boundary. */
export function durableMemory(memory) {
    if (!memory || typeof memory !== 'object' || Array.isArray(memory)) return {};
    return Object.fromEntries(Object.entries(memory).filter(([key]) => !key.startsWith('~')));
}
