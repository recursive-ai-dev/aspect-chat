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
    mixedContentWarning
} from './providers.js';
import { streamWebLLMChat } from './webllm.js';

/**
 * Parse an OpenAI-style SSE stream, invoking `onDelta` for each content chunk.
 *
 * Chunk boundaries do not respect line boundaries, so a partial line is carried
 * across reads in `pending` and only parsed once its newline arrives.
 */
export async function readSSEStream(reader, onDelta) {
    const decoder = new TextDecoder('utf-8');
    let full = '';
    let pending = '';

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

        const delta = data?.choices?.[0]?.delta?.content;
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

    // Flush a final line that arrived without a trailing newline.
    if (pending) consumeLine(pending);

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
 * Stream a chat completion from a single target.
 *
 * @returns {Promise<string>} the complete assistant message.
 */
export async function streamChat({ target, messages, params = {}, signal, onDelta, onProgress }) {
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

    const body = { messages, stream: true };
    if (target.model) body.model = target.model;
    if (typeof params.temperature === 'number') body.temperature = params.temperature;
    if (typeof params.maxTokens === 'number' && params.maxTokens > 0) body.max_tokens = params.maxTokens;
    if (typeof params.topP === 'number') body.top_p = params.topP;

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

    return readSSEStream(response.body.getReader(), onDelta);
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

    const body = { messages, stream: false };
    if (target.model) body.model = target.model;
    if (typeof params.temperature === 'number') body.temperature = params.temperature;
    if (typeof params.maxTokens === 'number' && params.maxTokens > 0) body.max_tokens = params.maxTokens;
    if (typeof params.topP === 'number') body.top_p = params.topP;

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
    const content = data?.choices?.[0]?.message?.content;
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
export async function streamChatWithFallback({ settings, messages, params, signal, onDelta, onProgress, onFallback }) {
    const primary = primaryTarget(settings);
    const secondary = fallbackTarget(settings);

    try {
        return await streamChat({ target: primary, messages, params, signal, onDelta, onProgress });
    } catch (err) {
        if (err.name === 'AbortError' || signal?.aborted) throw err;
        if (!secondary) throw err;

        if (onFallback) onFallback(err.message, secondary);

        try {
            return await streamChat({ target: secondary, messages, params, signal, onDelta, onProgress });
        } catch (fallbackErr) {
            if (fallbackErr.name === 'AbortError') throw fallbackErr;
            throw new Error(`Primary provider failed (${err.message}). Fallback also failed (${fallbackErr.message}).`);
        }
    }
}
