/** Approximation, not a tokenizer: UTF-8 bytes/3 is conservative for English and code. */
export function estimateRequestTokens(messages, tools = []) {
    const encoder = new TextEncoder();
    return messages.reduce((sum, message) => sum + 8 + Math.ceil(encoder.encode(String(message.content || '')).length / 3), 3)
        + (tools.length ? Math.ceil(encoder.encode(JSON.stringify(tools)).length / 3) : 0);
}
export function contextBudgetWarning(messages, params = {}, contextTokens = 8192) {
    const input = estimateRequestTokens(messages, params.tools);
    const output = params.maxTokens > 0 ? params.maxTokens : 1024;
    if (input + output < contextTokens * 0.85) return null;
    return `Estimated context: ${input.toLocaleString()} input + ${output.toLocaleString()} response tokens against a ${contextTokens.toLocaleString()}-token window. Reduce history or knowledge chunks, or increase the server's context window. Local quantized models may silently clip persona instructions; available context also depends on VRAM. This is an estimate.`;
}
