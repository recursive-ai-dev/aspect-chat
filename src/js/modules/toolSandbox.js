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
function sandboxBootstrap() {
    const channel = '__CHANNEL__';
    const send = (msg) => parent.postMessage(Object.assign({ channel }, msg), '*');

    // Tool code and the system tools call self.postMessage(...) expecting it to
    // reach the host (Worker semantics). Route it to the parent instead.
    self.postMessage = send;

    // Network: hand every request to the parent broker, which enforces the
    // per-tool permission. Everything else that can open a socket is removed.
    const netWaiters = new Map();
    let netSeq = 0;
    // Settle every outstanding brokered fetch when the run ends, so a tool that
    // started a request it never awaited does not leave a dangling promise in a
    // frame that is about to be discarded.
    const rejectPendingFetches = (reason) => {
        netWaiters.forEach((w) => { try { w.reject(new TypeError(reason)); } catch (_e) { /* already settled */ } });
        netWaiters.clear();
    };
    self.fetch = (input, init) => {
        init = init || {};
        const url = typeof input === 'string' ? input : (input && input.url);
        const method = String(
            init.method || (input && typeof input === 'object' && input.method) || 'GET'
        ).toUpperCase();
        let headers = {};
        try {
            if (init.headers && typeof init.headers === 'object') {
                headers = typeof init.headers.entries === 'function'
                    ? Object.fromEntries(init.headers.entries())
                    : Object.assign({}, init.headers);
            }
        } catch (_e) { headers = {}; }
        const body = typeof init.body === 'string' ? init.body : undefined;
        const id = ++netSeq;
        return new Promise((resolve, reject) => {
            netWaiters.set(id, { resolve, reject });
            send({ type: 'net-request', id, url, method, headers, body });
        });
    };
    const blocked = (name) => function () {
        throw new Error(name + ' is disabled inside tools. Use fetch().');
    };
    self.XMLHttpRequest = blocked('XMLHttpRequest');
    self.WebSocket = blocked('WebSocket');
    self.EventSource = blocked('EventSource');
    try { if (self.navigator) self.navigator.sendBeacon = () => false; } catch (_e) { /* frozen navigator */ }
    try { delete self.indexedDB; } catch (_e) { /* getter-only */ }

    self.addEventListener('message', async (e) => {
        const d = e && e.data;
        if (!d || d.channel !== channel) return;

        if (d.type === 'teardown') {
            rejectPendingFetches('Tool sandbox was torn down before this request completed.');
            return;
        }

        if (d.type === 'net-result') {
            const w = netWaiters.get(d.id);
            if (!w) return;
            netWaiters.delete(d.id);
            if (d.ok) {
                w.resolve(new Response(d.body, {
                    status: d.status || 200,
                    statusText: d.statusText || '',
                    headers: d.headers || {}
                }));
            } else {
                w.reject(new TypeError(d.error || 'Network request failed'));
            }
            return;
        }

        // memoryWriteComplete / summonComplete are consumed by the system-tool
        // listeners themselves; nothing to do here.
        if (d.type !== 'init') return;

        self.aspectMemory = d.memory || {};
        try {
            // The tool code ran as its own <script> in this document (the CSP
            // forbids eval), defining executeTool at global scope.
            let fn;
            try { fn = executeTool; } catch (_e) { fn = undefined; }
            if (typeof fn !== 'function') {
                throw new Error("Function executeTool(args, state) is not defined in this script.");
            }
            const result = await fn(d.args, d.state);
            rejectPendingFetches('Tool run finished before this request completed.');
            send({ type: 'done', ok: true, result, state: d.state });
        } catch (err) {
            rejectPendingFetches('Tool run failed before this request completed.');
            send({ type: 'done', ok: false, error: (err && err.message) || String(err) });
        }
    });

    send({ type: 'ready' });
}

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
    return 'ch_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
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
export function runSandboxedTool(opts) {
    const {
        code, args, state, memory, timeoutMs = 30000,
        signal, onPrivileged, onNetwork, _createFrame
    } = opts;

    const channel = randomChannel();

    return new Promise((resolve, reject) => {
        let settled = false;
        let iframe = null;
        let timer = null;
        let onAbort = null;

        const cleanup = () => {
            if (timer) clearTimeout(timer);
            window.removeEventListener('message', onMessage);
            if (onAbort && signal) signal.removeEventListener('abort', onAbort);
            if (iframe) {
                // Give the bootstrap a chance to reject any in-flight brokered
                // fetch before its context is destroyed.
                try { post({ type: 'teardown' }); } catch (_e) { /* frame already gone */ }
                if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
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
            if (!d || d.channel !== channel) return;

            if (d.type === 'ready') {
                post({ type: 'init', args, state, memory: memory || {} });
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
                Promise.resolve(onNetwork ? onNetwork(d) : { ok: false, error: 'Network disabled.' })
                    .then((res) => post(Object.assign({ type: 'net-result', id: d.id }, res)))
                    .catch((err) => post({
                        type: 'net-result', id: d.id, ok: false,
                        error: (err && err.message) || String(err)
                    }));
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

function defaultCreateFrame(html) {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:absolute;width:0;height:0;border:0;left:-9999px;';
    iframe.srcdoc = html;
    (document.body || document.documentElement).appendChild(iframe);
    return iframe;
}
