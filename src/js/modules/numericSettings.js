/** Bounds enforced at both persisted/input settings and request consumers. */
const limits = {
    maxContext: [1, 500, 20],
    contextTokens: [512, 2147483647, 8192],
    retrievalTopK: [1, 10, 4],
    toolTimeoutMs: [1000, 600000, 30000],
    maxKnowledgeChars: [1000, 5000000, 100000]
};

export function normalizeNumericSetting(key, value) {
    const [min, max, fallback] = limits[key];
    const number = value === null || value === undefined || String(value).trim() === '' ? NaN : Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.trunc(number))) : fallback;
}
