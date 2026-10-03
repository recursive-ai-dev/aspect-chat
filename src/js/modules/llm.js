/**
 * Unified chat transport.
 *
 * One entry point (`streamChat`) covers both HTTP OpenAI-compatible endpoints
 * and the in-browser WebLLM engine, so callers never branch on transport.
 * `streamChatWithFallback` layers the optional secondary provider on top —
 * typically "cloud primary, WebLLM when offline".
 */

import {
    WEBLLM_PROVIDER,
    isLocalEndpoint,
    getApiEndpoint,
    buildHeaders,
    requiresApiKey,
    describeConnectionError,
    describeHttpError,
    mixedContentWarning,
    supportsNativeTools
} from './providers.js';
import { streamWebLLMChat } from './webllm.js';

/**
 * Extract text from a choices[0].delta object, handling both string content
 * and multi-part content arrays (e.g. [{ type: 'text', text: '...' }]), as
 * well as completions-style text fields.
 */
export function extractDeltaText(data) {
    const choice = data?.choices?.[0];
    if (!choice) return '';
    const content = choice.delta?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .map(part => (typeof part === 'string' ? part : (part?.text || '')))
            .join('');
    }
    if (typeof choice.delta?.text === 'string') return choice.delta.text;
    if (typeof choice.text === 'string') return choice.text;
    return '';
}

/**
 * Extract text from a choices[0].message object, handling both string content
 * and multi-part content arrays.
 */
export function extractMessageContent(message) {
    if (!message) return null;
    const content = message.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .map(part => (typeof part === 'string' ? part : (part?.text || '')))
            .join('');
    }
    if (typeof message.text === 'string') return message.text;
    return null;
}

/**
 * Accumulate streaming tool_calls deltas from a single SSE event payload into
 * an in-progress map (index → {id, name, argsChunks[]}).
 * Returns nothing; caller owns the map.
 */
function accumulateToolCallDelta(data, toolCallsMap) {
    const choice = data?.choices?.[0];
    if (!choice) return;
    const deltas = choice.delta?.tool_calls;
    if (!Array.isArray(deltas)) return;
    for (const tc of deltas) {
        const idx = tc.index ?? 0;
        if (!toolCallsMap.has(idx)) {
            toolCallsMap.set(idx, { id: '', name: '', argsChunks: [] });
        }
        const entry = toolCallsMap.get(idx);
        if (tc.id) entry.id = tc.id;
        if (tc.function?.name) entry.name = tc.function.name;
        if (typeof tc.function?.arguments === 'string') {
            entry.argsChunks.push(tc.function.arguments);
        }
    }
}

/**
 * Convert a completed tool_calls accumulation map (or a non-streaming
 * `choices[0].message.tool_calls` array) into a flat `{name, args}` array.
 *
 * Works for both streaming (pass the Map) and non-streaming (pass the raw
 * tool_calls array from the response JSON).
 */
export function extractNativeToolCalls(source) {
    if (!source) return [];

    // Non-streaming: raw array from choices[0].message.tool_calls
    if (Array.isArray(source)) {
        return source
            .filter(tc => tc?.function?.name)
            .map(tc => ({
                ...(tc.id ? { id: tc.id } : {}),
                name: tc.function.name,
                args: typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments ?? {})
            }));
    }

    // Streaming: Map populated by accumulateToolCallDelta
    if (source instanceof Map) {
        const out = [];
        // Iterate in index order
        const sorted = [...source.entries()].sort((a, b) => a[0] - b[0]);
        for (const [, entry] of sorted) {
            if (!entry.name) continue;
            out.push({ ...(entry.id ? { id: entry.id } : {}), name: entry.name, args: entry.argsChunks.join('') });
        }
        return out;
    }

    return [];
}

/**
 * Parse an OpenAI-style SSE stream, invoking `onDelta` for each content chunk.
 *
 * When a `finish_reason: 'tool_calls'` chunk arrives (native function calling),
 * the accumulated tool calls are passed to the optional `onToolCall` callback
 * instead of being treated as text content.
 *
 * Chunk boundaries do not respect line boundaries, so a partial line is carried
 * across reads in `pending` and only parsed once its newline arrives.
 */
export async function readSSEStream(reader, onDelta, onToolCall) {
    const decoder = new TextDecoder('utf-8');
    let full = '';
    let pending = '';
    // Accumulator for streaming tool_calls fragments (index → entry).
    const toolCallsMap = new Map();
    let dispatched = false;

    const consumeLine = (rawLine) => {
        const line = rawLine.replace(/\r$/, '').trim();
        if (line === '' || !line.startsWith('data:')) return;

        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return;

        let data;
        try {
            data = JSON.parse(payload);
        } catch (e) {
            console.warn('Failed to parse SSE JSON chunk', e.message, payload);
            return;
        }

        // Some servers stream errors mid-body after a 200 OK.
        if (data.error) {
            throw new Error(data.error.message || String(data.error));
        }

        // Accumulate any tool_call delta fragments.
        accumulateToolCallDelta(data, toolCallsMap);

        // Detect finish_reason — either 'tool_calls' (native FC) or normal end.
        const choice = data?.choices?.[0];
        const finishReason = choice?.finish_reason;
        if (finishReason === 'tool_calls') {
            if (onToolCall && toolCallsMap.size > 0) {
                const calls = extractNativeToolCalls(toolCallsMap);
                if (calls.length > 0) onToolCall(calls);
                dispatched = true;
            }
            return;
        }

        const delta = extractDeltaText(data);
        if (delta) {
            full += delta;
            if (onDelta) onDelta(delta, full);
        }
    };

    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        pending += decoder.decode(value, { stream: true });
        const lines = pending.split('\n');
        pending = lines.pop();
        for (const line of lines) consumeLine(line);
    }

    // Flush any bytes the decoder is still holding (a final chunk that ended
    // mid–multibyte sequence, e.g. an emoji as the last token), then the
    // trailing line if it arrived without a newline.
    pending += decoder.decode();
    if (pending) consumeLine(pending);
    if (!dispatched && toolCallsMap.size && onToolCall) onToolCall(extractNativeToolCalls(toolCallsMap));

    return full;
}

/**
 * A resolved, ready-to-use provider configuration.
 * @typedef {{url: string, key: string, model: string, isWebLLM: boolean, label: string}} ChatTarget
 */

/** Build a ChatTarget from the primary settings. */
export function primaryTarget(settings) {
    const isWebLLM = settings.provider === WEBLLM_PROVIDER;
    return {
        url: isWebLLM ? WEBLLM_PROVIDER : (settings.apiUrl || '').trim(),
        key: (settings.apiKey || '').trim(),
        model: (settings.model || '').trim(),
        isWebLLM,
        label: isWebLLM ? 'WebLLM (in-browser)' : (settings.apiUrl || 'primary provider')
    };
}

/** Build a ChatTarget from the fallback settings, or null when none is set. */
export function fallbackTarget(settings) {
    const provider = settings.fallbackProvider;
    if (!provider) return null;

    if (provider === WEBLLM_PROVIDER) {
        const model = (settings.fallbackModel || '').trim();
        if (!model) return null;
        return {
            url: WEBLLM_PROVIDER,
            key: '',
            model,
            isWebLLM: true,
            label: 'WebLLM (in-browser)'
        };
    }

    const url = (settings.fallbackUrl || '').trim();
    if (!url) return null;
    return {
        url,
        key: (settings.fallbackKey || '').trim(),
        model: (settings.fallbackModel || '').trim(),
        isWebLLM: false,
        label: url
    };
}

/**
 * Validate a target before spending a network round trip on it.
 * Returns an error string, or null when the target is usable.
 */
export function validateTarget(target) {
    if (!target) return 'No provider configured.';
    if (target.isWebLLM) {
        return target.model ? null : 'No WebLLM model selected. Choose one in API Settings.';
    }
    if (!target.url) {
        return 'API credentials not configured. Click the gear icon in the sidebar to set your endpoint.';
    }
    if (requiresApiKey(target.url) && !target.key) {
        return 'This provider requires an API key. Add one in API Settings, or point Aspect Studio at a local server (Ollama, LM Studio) which needs no key.';
    }
    // A remote provider always needs an explicit model. Local servers such as
    // llama.cpp serve whichever model is currently loaded and accept a request
    // with no model field, so an empty box there is legitimate.
    if (!target.model && !isLocalEndpoint(target.url)) {
        return 'No model selected. Pick one in API Settings.';
    }
    const mixed = mixedContentWarning(target.url);
    if (mixed) return mixed;
    return null;
}

/**
 * True when the current settings could plausibly satisfy a request — i.e. the
 * primary target validates, or a configured fallback does. Used to send a user
 * who has not set anything up straight to Settings instead of a dead-end error.
 */
export function hasUsableProvider(settings) {
    if (!validateTarget(primaryTarget(settings))) return true;
    const fb = fallbackTarget(settings);
    return !!fb && !validateTarget(fb);
}

/**
 * Stream a chat completion from a single target.
 *
 * @returns {Promise<string>} the complete assistant message.
 */
export async function streamChat({ target, messages, params = {}, signal, onDelta, onProgress, onToolCall }) {
    const invalid = validateTarget(target);
    if (invalid) throw new Error(invalid);

    if (target.isWebLLM) {
        return streamWebLLMChat({
            model: target.model,
            messages,
            temperature: params.temperature,
            maxTokens: params.maxTokens,
            topP: params.topP,
            signal,
            onDelta,
            onProgress
        });
    }

    const ollama = /\/api\/chat\/?$/.test(target.url);
    const body = { messages, stream: true };
    if (target.model) body.model = target.model;
    if (typeof params.temperature === 'number') body.temperature = params.temperature;
    if (typeof params.maxTokens === 'number' && params.maxTokens > 0) body.max_tokens = params.maxTokens;
    if (typeof params.topP === 'number') body.top_p = params.topP;

    // Native function calling: attach the tools schema when the caller provides one.
    if (Array.isArray(params.tools) && params.tools.length > 0 && params.toolCallingMode !== 'markers' &&
        (params.toolCallingMode === 'native' || supportsNativeTools(target.url))) {
        body.tools = params.tools;
        if (!ollama) body.tool_choice = 'auto';
    }
    if (ollama) {
        body.options = {};
        if (typeof params.temperature === 'number') body.options.temperature = params.temperature;
        if (typeof params.topP === 'number') body.options.top_p = params.topP;
        if (params.maxTokens > 0) body.options.num_predict = params.maxTokens;
        if (params.contextTokens > 0) body.options.num_ctx = params.contextTokens;
        delete body.temperature;
        delete body.top_p;
        delete body.max_tokens;
    }

    let response;
    try {
        response = await fetch(getApiEndpoint(target.url), {
            method: 'POST',
            headers: buildHeaders(target.key),
            body: JSON.stringify(body),
            signal
        });
    } catch (err) {
        if (err.name === 'AbortError') throw err;
        throw new Error(describeConnectionError(err, target.url));
    }

    if (!response.ok) {
        throw new Error(await describeHttpError(response));
    }
    if (!response.body) {
        throw new Error('The server returned no response body. It may not support streaming.');
    }

    const reader = response.body.getReader();
    try {
        return await (ollama ? readOllamaStream(reader, onDelta, onToolCall) : readSSEStream(reader, onDelta, onToolCall));
    } finally {
        try { await reader.cancel(); } catch { /* aborted stream */ }
        reader.releaseLock();
    }
}

export async function readOllamaStream(reader, onDelta, onToolCall) {
    const decoder = new TextDecoder();
    let pending = '', full = '';
    const calls = [];
    const consume = line => {
        if (!line.trim()) return;
        const data = JSON.parse(line);
        if (data.error) throw new Error(String(data.error));
        const delta = data.message?.content || '';
        full += delta;
        if (delta && onDelta) onDelta(delta, full);
        calls.push(...extractNativeToolCalls(data.message?.tool_calls));
    };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        const lines = pending.split('\n');
        pending = lines.pop();
        lines.forEach(consume);
    }
    pending += decoder.decode();
    consume(pending);
    if (calls.length && onToolCall) onToolCall(calls);
    return full;
}

/**
 * Request a single non-streamed completion. Used for Aspect-to-Aspect summons,
 * where there is no bubble to stream into.
 */
export async function completeChat({ target, messages, params = {}, signal }) {
    const invalid = validateTarget(target);
    if (invalid) throw new Error(invalid);

    if (target.isWebLLM) {
        // The engine only exposes a streaming-friendly API here; collecting the
        // stream gives the same result without a second code path.
        return streamWebLLMChat({
            model: target.model,
            messages,
            temperature: params.temperature,
            maxTokens: params.maxTokens,
            topP: params.topP,
            signal
        });
    }

    const ollama = /\/api\/chat\/?$/.test(target.url);
    const body = { messages, stream: false };
    if (target.model) body.model = target.model;
    if (typeof params.temperature === 'number') body.temperature = params.temperature;
    if (typeof params.maxTokens === 'number' && params.maxTokens > 0) body.max_tokens = params.maxTokens;
    if (typeof params.topP === 'number') body.top_p = params.topP;
    if (ollama) {
        body.options = { temperature: params.temperature, top_p: params.topP };
        if (params.maxTokens > 0) body.options.num_predict = params.maxTokens;
        if (params.contextTokens > 0) body.options.num_ctx = params.contextTokens;
        delete body.temperature;
        delete body.top_p;
        delete body.max_tokens;
    }

    let response;
    try {
        response = await fetch(getApiEndpoint(target.url), {
            method: 'POST',
            headers: buildHeaders(target.key),
            body: JSON.stringify(body),
            signal
        });
    } catch (err) {
        if (err.name === 'AbortError') throw err;
        throw new Error(describeConnectionError(err, target.url));
    }

    if (!response.ok) {
        throw new Error(await describeHttpError(response));
    }

    const data = await response.json().catch(() => ({}));
    const content = extractMessageContent(ollama ? data.message : data?.choices?.[0]?.message);
    if (content == null) {
        throw new Error('Empty response from model.');
    }
    return content;
}

/**
 * Try the primary target; on failure, try the configured fallback.
 *
 * A user abort is never retried — the user asked it to stop. Everything else
 * (server down, bad key, rate limit, offline) is worth a second attempt on the
 * fallback, which is the whole point of configuring one.
 *
 * `onFallback(reason, target)` fires before the retry so the UI can say why.
 */
export async function streamChatWithFallback({ settings, messages, params, signal, onDelta, onProgress, onFallback, onToolCall }) {
    const primary = primaryTarget(settings);
    const secondary = fallbackTarget(settings);

    try {
        return await streamChat({ target: primary, messages, params, signal, onDelta, onProgress, onToolCall });
    } catch (err) {
        if (err.name === 'AbortError' || signal?.aborted) throw err;
        if (!secondary) throw err;

        if (onFallback) onFallback(err.message, secondary);

        try {
            return await streamChat({ target: secondary, messages, params, signal, onDelta, onProgress, onToolCall });
        } catch (fallbackErr) {
            if (fallbackErr.name === 'AbortError') throw fallbackErr;
            throw new Error(`Primary provider failed (${err.message}). Fallback also failed (${fallbackErr.message}).`);
        }
    }
}
