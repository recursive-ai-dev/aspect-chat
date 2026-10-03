export function sandboxBootstrap() {
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
        const promise = new Promise((resolve, reject) => {
            netWaiters.set(id, { resolve, reject });
            send({ type: 'net-request', id, url, method, headers, body });
        });
        // Callers still observe rejection; fire-and-forget fetches don't emit
        // unhandled rejections when teardown drains them.
        promise.catch(() => {});
        return promise;
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
        if (!d || d.channel !== channel || (e.source && e.source !== parent)) return;

        if (d.type === 'teardown') {
            rejectPendingFetches('Tool sandbox was torn down before this request completed.');
            send({ type: 'teardown-complete' });
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
            if (typeof d.code === 'string') {
                const script = document.createElement('script');
                script.textContent = d.code;
                document.body.appendChild(script);
            }
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
