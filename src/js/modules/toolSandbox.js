import { sandboxBootstrap } from './sandboxBootstrap.js';
/**
 * Run one Aspect tool's code in a locked-down iframe.
 *
 * Why an iframe and not a Worker: a `blob:` Worker runs at the page's own
 * origin, so it can open the app's IndexedDB (every Aspect's instructions,
 * knowledge, memory, other tools' code) and `fetch` it anywhere. A
 * `sandbox="allow-scripts"` iframe WITHOUT `allow-same-origin` gets a unique
 * opaque origin instead: `localStorage` / `indexedDB` throw, there are no
 * cookies, and there is no handle to the parent DOM. Its CSP blocks the
 * network outright — the tool reaches the network only through `onNetwork`
 * in the parent, which is where the per-tool "allow network?" prompt lives.
 *
 * The message contract deliberately matches the old Worker one so the system
 * tools in systemTools.js (`self.postMessage({type:'writeMemory'|…})`,
 * `self.addEventListener('message', …)`, `self.aspectMemory`) run unchanged:
 * the bootstrap shims `self.postMessage` to forward to the parent.
 *
 * Every message carries `channel`, a per-run random id, because a sandboxed
 * iframe posts with `origin === "null"` and cannot be authenticated by origin.
 */

const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'none'; connect-src 'none'";

/** Bootstrap that runs inside the sandbox. `__CHANNEL__` is substituted per run. */

function buildSrcdoc(channel, toolCode) {
    const boot = `(${sandboxBootstrap.toString().replace('__CHANNEL__', channel)})();`;
    // The tool runs as a normal inline script (no eval under this CSP). Neutralise
    // any literal `</script` so hostile code can't close the tag early; `<\/script`
    // parses identically to `</script` everywhere it could legally appear in JS.
    const safeTool = String(toolCode == null ? '' : toolCode).replace(/<\/(script)/gi, '<\\/$1');
    return `<!DOCTYPE html><html><head>` +
        `<meta http-equiv="Content-Security-Policy" content="${CSP}">` +
        `</head><body>` +
        `<script>${boot}<\/script>` +
        `<script>\n${safeTool}\n<\/script>` +
        `</body></html>`;
}

const randomChannel = () => {
    const c = (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
    if (c && typeof c.randomUUID === 'function') return 'ch_' + c.randomUUID();
    if (c && typeof c.getRandomValues === 'function') {
        const b = new Uint8Array(16);
        c.getRandomValues(b);
        return 'ch_' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    }
    throw new Error('Web Crypto is required to run tools securely.');
};

/**
 * @param {object}   opts
 * @param {string}   opts.code         the tool's source (defines executeTool)
 * @param {*}        opts.args         parsed arguments
 * @param {object}   opts.state        persisted per-tool state (sent back updated)
 * @param {object}   opts.memory       Aspect memory snapshot (for ReadMemory)
 * @param {number}   opts.timeoutMs    hard wall-clock limit
 * @param {AbortSignal} [opts.signal]  cancels the run
 * @param {(msg:object)=>void} opts.onPrivileged  relay for writeMemory / summonAspect
 * @param {(req:object)=>Promise<object>} opts.onNetwork  the network broker
 * @param {(html:string)=>HTMLIFrameElement} [opts._createFrame]  test seam
 * @returns {Promise<{result:*, state:object}>}
 */
function runToolInFrame(opts) {
    const {
        code, args, state, memory, timeoutMs = 30000,
        signal, onPrivileged, onNetwork, _createFrame, _channel, _releaseFrame
    } = opts;

    const channel = _channel || randomChannel();

    return new Promise((resolve, reject) => {
        let settled = false;
        let iframe = null;
        let timer = null;
        let onAbort = null;
        const networkController = new AbortController();
        const netWaiters = new Map();

        const cleanup = () => {
            networkController.abort();
            for (const waiter of netWaiters.values()) waiter.reject(new Error('Tool execution aborted or timed out during pending fetch'));
            netWaiters.clear();
            if (timer) clearTimeout(timer);
            window.removeEventListener('message', onMessage);
            if (onAbort && signal) signal.removeEventListener('abort', onAbort);
            if (iframe) {
                const frame = iframe;
                const dispose = () => {
                    clearTimeout(disposalTimer);
                    window.removeEventListener('message', acknowledge);
                    if (_releaseFrame) _releaseFrame();
                    else if (frame.parentNode) frame.parentNode.removeChild(frame);
                };
                const acknowledge = event => {
                    if (event.data?.channel === channel && event.data.type === 'teardown-complete' &&
                        (!event.source || event.source === frame.contentWindow)) dispose();
                };
                const disposalTimer = setTimeout(dispose, 50);
                window.addEventListener('message', acknowledge);
                // Give the bootstrap a chance to reject any in-flight brokered
                // fetch before its context is destroyed.
                try { post({ type: 'teardown' }); } catch (_e) { /* frame already gone */ }
                // Acknowledgement lets the frame drain its promises before
                // destruction. The deadline also handles an infinite JS loop.
            }
            iframe = null;
        };
        const finish = (fn, val) => {
            if (settled) return;
            settled = true;
            cleanup();
            fn(val);
        };

        const post = (msg) => {
            try {
                iframe && iframe.contentWindow &&
                    iframe.contentWindow.postMessage(Object.assign({ channel }, msg), '*');
            } catch (_e) { /* frame already gone */ }
        };

        // A tool that returns from executeTool ends the run. One that never
        // returns but keeps firing net-request / writeMemory / summonAspect
        // messages would otherwise drive unbounded work (real fetches, provider
        // calls, DB writes) until the timeout. Cap host-side actions per run.
        let hostActions = 0;
        const MAX_HOST_ACTIONS = 40;

        function onMessage(e) {
            const d = e && e.data;
            if (settled || !d || d.channel !== channel || (e.source && e.source !== iframe?.contentWindow)) return;

            if (d.type === 'ready') {
                post({ type: 'init', args, state, memory: memory || {}, ...(_releaseFrame ? { code } : {}) });
                return;
            }
            if (d.type === 'done') {
                if (d.ok) finish(resolve, { result: d.result, state: d.state });
                else finish(reject, new Error(d.error || 'Tool execution failed'));
                return;
            }

            if (d.type === 'net-request' || d.type === 'writeMemory' || d.type === 'summonAspect') {
                if (++hostActions > MAX_HOST_ACTIONS) {
                    finish(reject, new Error(
                        `Tool made more than ${MAX_HOST_ACTIONS} host requests in one run.`));
                    return;
                }
            }

            if (d.type === 'net-request') {
                if (netWaiters.has(d.id)) {
                    finish(reject, new Error('Duplicate sandbox network request identifier.'));
                    return;
                }
                const pending = new Promise((resolve, reject) => {
                    netWaiters.set(d.id, { reject });
                    Promise.resolve().then(() => onNetwork ? onNetwork({ ...d, signal: networkController.signal }) : { ok: false, error: 'Network disabled.' }).then(resolve, reject);
                });
                pending
                    .then((res) => post(Object.assign({ type: 'net-result', id: d.id }, res)))
                    .catch((err) => post({
                        type: 'net-result', id: d.id, ok: false,
                        error: (err && err.message) || String(err)
                    }))
                    .finally(() => netWaiters.delete(d.id));
                return;
            }
            // writeMemory / summonAspect: the parent does the privileged work and
            // must post the *-Complete reply back into the frame.
            if (onPrivileged) onPrivileged(d, post);
        }

        window.addEventListener('message', onMessage);

        timer = setTimeout(() => {
            finish(reject, new Error(
                `Tool execution timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
        }, timeoutMs);

        if (signal) {
            if (signal.aborted) {
                finish(reject, new Error('Tool execution aborted.'));
                return;
            }
            onAbort = () => finish(reject, new Error('Tool execution aborted.'));
            signal.addEventListener('abort', onAbort);
        }

        try {
            iframe = _createFrame
                ? _createFrame(buildSrcdoc(channel, code))
                : defaultCreateFrame(buildSrcdoc(channel, code));
        } catch (err) {
            finish(reject, err instanceof Error ? err : new Error(String(err)));
        }
    });
}

// Keep three mounted containers. Each lease gets a fresh opaque-origin document:
// globals, listeners, timers, and tool scripts never survive into the next run.
const pool = [];
const queue = [];
function warmSlot(slot) {
    slot.channel = randomChannel();
    slot.ready = false;
    slot.frame.removeAttribute('srcdoc');
    slot.frame.src = new URL('tool-sandbox.html', document.baseURI).href + '#' + slot.channel;
}
function pumpPool() {
    for (const slot of pool) {
        if (slot.busy || !slot.ready || !queue.length) continue;
        const task = queue.shift();
        task.detach();
        slot.busy = true;
        task.resolve(slot);
    }
}
function acquireFrame(signal, timeoutMs) {
    if (!pool.length) {
        window.addEventListener('message', event => {
            const slot = pool.find(item => event.source === item.frame.contentWindow && event.data?.channel === item.channel);
            if (slot && event.data.type === 'ready') { slot.ready = true; pumpPool(); }
        });
        for (let i = 0; i < 3; i++) {
            const slot = { frame: defaultCreateFrame(''), busy: false };
            pool.push(slot);
            warmSlot(slot);
        }
    }
    return new Promise((resolve, reject) => {
        let timer;
        const cancel = () => {
            const index = queue.indexOf(task);
            if (index !== -1) queue.splice(index, 1);
            task.detach();
            reject(new Error(signal?.aborted ? 'Tool execution aborted.' : 'Tool sandbox queue timed out.'));
        };
        const task = { resolve, detach: () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); } };
        queue.push(task);
        timer = setTimeout(cancel, timeoutMs);
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) cancel();
        else pumpPool();
    });
}
export function runSandboxedTool(opts) {
    if (opts._createFrame) return runToolInFrame(opts);
    return runPooledTool(opts);
}
async function runPooledTool(opts) {
    const timeoutMs = opts.timeoutMs ?? 30000;
    const started = Date.now();
    const slot = await acquireFrame(opts.signal, timeoutMs);
    let released = false;
    const release = () => {
        if (released) return;
        released = true;
        // Teardown is delivered before replacing the document. A fresh page
        // also destroys any timer or listener the tool left behind.
        setTimeout(() => {
            warmSlot(slot);
            slot.busy = false;
        }, 0);
    };
    if (opts.signal?.aborted) { release(); throw new Error('Tool execution aborted.'); }
    return runToolInFrame({ ...opts, timeoutMs: Math.max(1, timeoutMs - (Date.now() - started)),
            _channel: slot.channel, _releaseFrame: release,
            _createFrame: () => {
                queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', {
                    source: slot.frame.contentWindow, data: { channel: slot.channel, type: 'ready' }
                })));
                return slot.frame;
            }
    });
}

function defaultCreateFrame(html) {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:absolute;width:0;height:0;border:0;left:-9999px;';
    iframe.srcdoc = html;
    (document.body || document.documentElement).appendChild(iframe);
    return iframe;
}
