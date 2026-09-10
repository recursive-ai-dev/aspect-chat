/**
 * Provider catalog and endpoint helpers.
 *
 * Aspect Studio talks to any OpenAI-compatible /v1 endpoint. The important
 * distinction this module encodes is that *local* runners (Ollama, LM Studio,
 * llama.cpp, vLLM...) do not require an API key, while hosted providers do.
 * Treating a missing key as a hard error is what previously made local models
 * impossible to use at all.
 */

export const WEBLLM_PROVIDER = 'webllm';

/**
 * Known providers. `id` doubles as the <select> value: for HTTP providers it is
 * the base URL, so selecting one fills the URL field directly.
 */
export const PROVIDERS = [
    {
        id: 'custom',
        label: 'Custom',
        url: '',
        local: false,
        requiresKey: false,
        hint: 'Enter any OpenAI-compatible base URL ending in /v1.'
    },
    {
        id: WEBLLM_PROVIDER,
        label: 'WebLLM (in-browser, no server)',
        url: '',
        local: true,
        requiresKey: false,
        hint: 'Runs the model inside this browser tab via WebGPU. The first load downloads model weights and caches them.'
    },
    {
        id: 'http://localhost:11434/v1',
        label: 'Ollama (local)',
        url: 'http://localhost:11434/v1',
        local: true,
        requiresKey: false,
        hint: 'Start Ollama, then run: OLLAMA_ORIGINS="*" ollama serve — the browser needs CORS permission to reach it.'
    },
    {
        id: 'http://localhost:1234/v1',
        label: 'LM Studio (local)',
        url: 'http://localhost:1234/v1',
        local: true,
        requiresKey: false,
        hint: 'In LM Studio open the Developer/Server tab, load a model, and start the server on port 1234.'
    },
    {
        id: 'http://localhost:8080/v1',
        label: 'llama.cpp / llama-server (local)',
        url: 'http://localhost:8080/v1',
        local: true,
        requiresKey: false,
        hint: 'Run llama-server with --host 127.0.0.1 --port 8080. Add the bundled llama-bridge if you hit CORS errors.'
    },
    {
        id: 'http://localhost:5001/v1',
        label: 'KoboldCpp (local)',
        url: 'http://localhost:5001/v1',
        local: true,
        requiresKey: false,
        hint: 'KoboldCpp exposes an OpenAI-compatible API on port 5001 by default.'
    },
    {
        id: 'http://localhost:8000/v1',
        label: 'vLLM (local)',
        url: 'http://localhost:8000/v1',
        local: true,
        requiresKey: false,
        hint: 'vllm serve <model> listens on port 8000 by default.'
    },
    {
        id: 'https://api.openai.com/v1',
        label: 'OpenAI',
        url: 'https://api.openai.com/v1',
        local: false,
        requiresKey: true
    },
    {
        id: 'https://api.groq.com/openai/v1',
        label: 'Groq',
        url: 'https://api.groq.com/openai/v1',
        local: false,
        requiresKey: true
    },
    {
        id: 'https://api.cerebras.ai/v1',
        label: 'Cerebras',
        url: 'https://api.cerebras.ai/v1',
        local: false,
        requiresKey: true
    },
    {
        id: 'https://openrouter.ai/api/v1',
        label: 'OpenRouter',
        url: 'https://openrouter.ai/api/v1',
        local: false,
        requiresKey: true
    },
    {
        id: 'https://api.cohere.ai/compatibility/v1',
        label: 'Cohere',
        url: 'https://api.cohere.ai/compatibility/v1',
        local: false,
        requiresKey: true
    },
    {
        id: 'https://api.arliai.com/v1',
        label: 'ArliAI',
        url: 'https://api.arliai.com/v1',
        local: false,
        requiresKey: true
    },
    {
        id: 'https://api.mistral.ai/v1',
        label: 'Mistral',
        url: 'https://api.mistral.ai/v1',
        local: false,
        requiresKey: true
    },
    {
        id: 'https://api.deepseek.com/v1',
        label: 'DeepSeek',
        url: 'https://api.deepseek.com/v1',
        local: false,
        requiresKey: true
    },
    {
        id: 'https://generativelanguage.googleapis.com/v1beta/openai',
        label: 'Google Gemini (OpenAI-compatible)',
        url: 'https://generativelanguage.googleapis.com/v1beta/openai',
        local: false,
        requiresKey: true
    }
];

export function getProvider(id) {
    return PROVIDERS.find(p => p.id === id) || null;
}

/** Hostnames that are always the user's own machine. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

/**
 * True when the URL points at the user's own machine or private network, where
 * an API key is conventionally not required.
 *
 * Recognises loopback, RFC1918 ranges (10/8, 172.16/12, 192.168/16), the
 * 100.64/10 CGNAT range used by Tailscale, link-local 169.254/16, and the
 * .local / .internal / .lan mDNS suffixes.
 */
export function isLocalEndpoint(url) {
    if (!url || typeof url !== 'string') return false;
    let host = '';
    try {
        const parsed = new URL(url);
        // `new URL('localhost:11434')` parses without throwing, treating
        // "localhost:" as the scheme and leaving hostname empty. Only trust the
        // parse when it produced a real web URL.
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            host = parsed.hostname.toLowerCase();
        }
    } catch {
        // Not parseable at all — fall through to the string check below.
    }

    if (!host) {
        // A half-typed "localhost:11434" or "192.168.1.5:1234" should still read
        // as local while the user is typing, so the key field stays hidden.
        const raw = url.toLowerCase().replace(/^[a-z]+:\/\//, '').split('/')[0];
        const bare = raw.split(':')[0];
        if (LOOPBACK_HOSTS.has(bare)) return true;
        host = bare;
        if (!host) return false;
    }

    if (LOOPBACK_HOSTS.has(host)) return true;
    if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) return true;

    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
        const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
        if (a === 10) return true;
        if (a === 127) return true;
        if (a === 192 && b === 168) return true;
        if (a === 172 && b >= 16 && b <= 31) return true;
        if (a === 100 && b >= 64 && b <= 127) return true;
        if (a === 169 && b === 254) return true;
    }

    return false;
}

/**
 * Whether a request to this endpoint needs an Authorization header to succeed.
 * Local endpoints do not; a key supplied anyway is still sent, because some
 * local setups sit behind an auth proxy.
 */
export function requiresApiKey(url) {
    if (url === WEBLLM_PROVIDER) return false;
    return !isLocalEndpoint(url);
}

/** Normalise a base URL into a full chat-completions endpoint. */
export function getApiEndpoint(apiUrl) {
    let endpoint = (apiUrl || '').trim();
    if (!endpoint.endsWith('/chat/completions') && !endpoint.endsWith('/chat/completions/')) {
        endpoint = endpoint.replace(/\/+$/, '') + '/chat/completions';
    }
    return endpoint;
}

/** Normalise a base URL into a full models-list endpoint. */
export function getModelsEndpoint(apiUrl) {
    let endpoint = (apiUrl || '').trim();
    if (!endpoint.endsWith('/models') && !endpoint.endsWith('/models/')) {
        endpoint = endpoint.replace(/\/+$/, '') + '/models';
    }
    return endpoint;
}

export function buildHeaders(apiKey, extra = {}) {
    const headers = { 'Content-Type': 'application/json', ...extra };
    const key = (apiKey || '').trim();
    if (key) headers['Authorization'] = `Bearer ${key}`;
    return headers;
}

/**
 * Turn a fetch failure into something a user can act on.
 *
 * A browser cannot distinguish "server down" from "server up but refused the
 * cross-origin request" — both surface as an opaque TypeError. For local URLs
 * that ambiguity is almost always CORS, so we say so and name the fix.
 */
export function describeConnectionError(err, url) {
    const base = err && err.message ? err.message : String(err);
    if (!isLocalEndpoint(url)) {
        return `Network error: ${base}. Check the endpoint URL and your internet connection.`;
    }

    if (url.includes('11434')) {
        return `Could not reach Ollama at ${url}. Make sure it is running, and start it with CORS enabled: OLLAMA_ORIGINS="*" ollama serve`;
    }
    if (url.includes('1234')) {
        return `Could not reach LM Studio at ${url}. Open LM Studio, load a model, start the local server, and enable CORS in the server settings.`;
    }
    return `Could not reach the local server at ${url}. Confirm it is running and that it allows cross-origin requests from ${typeof location !== 'undefined' ? location.origin : 'this page'}.`;
}

/**
 * Read an error body from a non-OK response and turn it into a readable message.
 * Consumes the body, so only call this on a response you are done with.
 */
export async function describeHttpError(response) {
    let detail = response.statusText || '';
    try {
        const text = await response.text();
        if (text) {
            try {
                const data = JSON.parse(text);
                detail = data?.error?.message || data?.message || data?.error || detail || text.slice(0, 300);
            } catch {
                detail = text.slice(0, 300);
            }
        }
    } catch {
        // Body already consumed or unreadable — the status code alone still tells us something.
    }

    if (response.status === 401 || response.status === 403) {
        return `Unauthorized (${response.status}). ${detail || 'Check your API key.'}`;
    }
    if (response.status === 404) {
        return `Not found (404). ${detail || 'Check the base URL — it usually ends in /v1.'}`;
    }
    if (response.status === 429) {
        return `Rate limited (429). ${detail || 'Wait a moment and try again.'}`;
    }
    return `Error ${response.status}: ${detail}`;
}

/**
 * Fetch the model list from an OpenAI-compatible endpoint.
 * Returns an array of model id strings.
 */
export async function fetchProviderModels(url, key) {
    const fetchUrl = getModelsEndpoint(url);

    let response;
    try {
        response = await fetch(fetchUrl, { headers: buildHeaders(key) });
    } catch (e) {
        throw new Error(describeConnectionError(e, url));
    }

    if (!response.ok) {
        throw new Error(await describeHttpError(response));
    }

    const data = await response.json().catch(() => null);
    const raw = data?.data || data?.models || [];
    if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error('No models found. The endpoint responded, but returned an empty model list.');
    }

    return raw
        .map(m => (typeof m === 'string' ? m : m.id || m.name || m.model))
        .filter(Boolean);
}

/**
 * Probe an endpoint and report back in plain language.
 * Never throws — the result object is the whole answer.
 */
export async function testConnection(url, key) {
    const trimmed = (url || '').trim();
    if (!trimmed) {
        return { ok: false, message: 'Enter an endpoint URL first.' };
    }
    if (requiresApiKey(trimmed) && !(key || '').trim()) {
        return { ok: false, message: 'This provider needs an API key.' };
    }

    try {
        const models = await fetchProviderModels(trimmed, key);
        const local = isLocalEndpoint(trimmed);
        return {
            ok: true,
            models,
            message: `Connected${local ? ' to local server' : ''} — ${models.length} model${models.length === 1 ? '' : 's'} available.`
        };
    } catch (e) {
        return { ok: false, message: e.message };
    }
}

/**
 * Whether the provider at `url` is known to support native function calling
 * (the OpenAI `tools` / `tool_choice` request fields).
 *
 * Returns true for every provider we have verified accepts the schema.
 * Returns false for WebLLM (runs in-browser, not an HTTP endpoint) and for
 * unknown / custom URLs — it is always safe to fall back to the text-marker
 * path, so unknown is conservatively false.
 */
export function supportsNativeTools(url) {
    if (!url || url === WEBLLM_PROVIDER) return false;

    // Known-capable hosted providers (exact prefix match on base URL).
    const CAPABLE_PREFIXES = [
        'https://api.openai.com/',
        'https://api.groq.com/',
        'https://api.cerebras.ai/',
        'https://openrouter.ai/',
        'https://api.mistral.ai/',
        'https://api.deepseek.com/',
        'https://generativelanguage.googleapis.com/',
    ];

    const trimmed = url.trim();
    for (const prefix of CAPABLE_PREFIXES) {
        if (trimmed.startsWith(prefix)) return true;
    }

    // Local servers: Ollama (11434) and LM Studio (1234) both support tools.
    // Detect them via isLocalEndpoint + well-known port patterns.
    if (isLocalEndpoint(trimmed)) {
        if (trimmed.includes(':11434')) return true; // Ollama
        if (trimmed.includes(':1234'))  return true; // LM Studio
    }

    return false;
}

/**
 * Warn about the one mixed-content case that silently breaks local models:
 * an https:// page cannot reach an http://localhost server in most browsers.
 */
export function mixedContentWarning(url) {
    if (typeof location === 'undefined') return null;
    if (location.protocol !== 'https:') return null;
    if (!url || !url.startsWith('http://')) return null;
    return 'This page is served over HTTPS, so the browser will block plain-HTTP requests to your local server. Run Aspect Studio over http:// (for example the local dev server) to use local models.';
}
