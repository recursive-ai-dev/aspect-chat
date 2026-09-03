/**
 * WebLLM engine wrapper.
 *
 * Runs a model entirely inside the browser tab via WebGPU — no server, no key,
 * no network once the weights are cached. The engine is heavy to construct, so
 * it is created lazily and reused until the selected model changes.
 */

let engine = null;
let currentModelId = null;
let loadingPromise = null;
let cachedModelList = null;

// All engine lifecycle operations run through this chain so two rapid calls
// (e.g. a fast model switch, or a double-send) can never build two engines at
// once and leave `engine` pointing at whichever finished last.
let opChain = Promise.resolve();
function serialize(fn) {
    const run = opChain.then(fn, fn);
    opChain = run.then(() => {}, () => {});
    return run;
}

/**
 * The web-llm bundle is large. Import it only when a WebLLM model is actually
 * requested so it never lands in the critical path of a normal API-backed chat.
 */
async function loadWebLLM() {
    return import('@mlc-ai/web-llm');
}

/** True when this browser can run WebLLM at all. */
export function isWebGPUAvailable() {
    return typeof navigator !== 'undefined' && !!navigator.gpu;
}

/** Model ids available for in-browser inference. */
export async function getWebLLMModels() {
    if (cachedModelList) return cachedModelList;
    const { prebuiltAppConfig } = await loadWebLLM();
    cachedModelList = prebuiltAppConfig.model_list.map(m => m.model_id);
    return cachedModelList;
}

/**
 * Get (or build) an engine for `modelId`.
 *
 * Concurrent calls for the same model share one initialisation: without this,
 * a fast double-send would start two multi-gigabyte downloads at once.
 */
export function initWebLLMEngine(modelId, initProgressCallback) {
    if (!modelId) {
        return Promise.reject(new Error('No WebLLM model selected. Choose one in API Settings.'));
    }
    // Fast path: the engine is already the one we want.
    if (engine && currentModelId === modelId && !loadingPromise) {
        return Promise.resolve(engine);
    }

    return serialize(async () => {
        // Re-check inside the queue: a preceding op may have built exactly this.
        if (engine && currentModelId === modelId) {
            return engine;
        }
        if (!isWebGPUAvailable()) {
            throw new Error('WebLLM needs WebGPU, which this browser does not expose. Use a recent Chrome, Edge, or Chromium build, or point Aspect Studio at a local server instead.');
        }

        // Switching models: free the old engine's GPU buffers first.
        if (engine && currentModelId !== modelId && typeof engine.unload === 'function') {
            try { await engine.unload(); } catch { /* best effort */ }
            engine = null;
        }

        currentModelId = modelId;
        loadingPromise = (async () => {
            try {
                const { CreateMLCEngine } = await loadWebLLM();
                engine = await CreateMLCEngine(modelId, { initProgressCallback });
                return engine;
            } catch (err) {
                engine = null;
                currentModelId = null;
                throw new Error(`Failed to load WebLLM model "${modelId}": ${err.message}`);
            } finally {
                loadingPromise = null;
            }
        })();
        return loadingPromise;
    });
}

export function getEngine() {
    return engine;
}

/** Drop the engine and free its GPU buffers. */
export function unloadWebLLMEngine() {
    return serialize(async () => {
        if (engine && typeof engine.unload === 'function') {
            try {
                await engine.unload();
            } catch (err) {
                console.warn('WebLLM engine unload failed', err.message);
            }
        }
        engine = null;
        currentModelId = null;
        loadingPromise = null;
    });
}

/**
 * Stream a chat completion from the in-browser engine.
 *
 * `onDelta(text)` receives each token chunk. Returns the full message.
 * Mirrors the shape of the HTTP streaming path in llm.js so callers do not
 * care which transport is in use.
 */
export async function streamWebLLMChat({ model, messages, temperature, maxTokens, topP, signal, onDelta, onProgress }) {
    const activeEngine = await initWebLLMEngine(model, onProgress);

    if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
    }

    const request = {
        messages,
        stream: true,
        temperature: typeof temperature === 'number' ? temperature : 0.7
    };
    if (typeof maxTokens === 'number' && maxTokens > 0) request.max_tokens = maxTokens;
    if (typeof topP === 'number') request.top_p = topP;

    const chunks = await activeEngine.chat.completions.create(request);

    let full = '';
    try {
        for await (const chunk of chunks) {
            if (signal?.aborted) {
                throw new DOMException('Aborted', 'AbortError');
            }
            const delta = chunk?.choices?.[0]?.delta?.content;
            if (delta) {
                full += delta;
                if (onDelta) onDelta(delta, full);
            }
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            // Stop generation in the engine too, or it keeps burning GPU time.
            if (typeof activeEngine.interruptGenerate === 'function') {
                try { activeEngine.interruptGenerate(); } catch { /* best effort */ }
            }
        }
        throw err;
    }

    return full;
}

/** Test-only: clear cached module state between cases. */
export function resetWebLLMForTesting() {
    engine = null;
    currentModelId = null;
    loadingPromise = null;
    cachedModelList = null;
    opChain = Promise.resolve();
}
