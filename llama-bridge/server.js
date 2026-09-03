/**
 * Aspect Studio local bridge.
 *
 * A small reverse proxy that sits between the browser and a local inference
 * server (llama.cpp, Ollama, LM Studio, vLLM…). Use it when the engine cannot
 * be told to send CORS headers of its own — the browser refuses to read a
 * cross-origin response without them, and the failure surfaces as an opaque
 * "network error" that looks identical to the server being down.
 *
 * It also synthesises a /v1/models response for engines that do not implement
 * one, so Aspect Studio's model dropdown still populates.
 *
 *   node server.js
 *   PORT=9090 LLAMA_API_URL=http://localhost:11434/v1 node server.js
 *
 * ES modules, because the repository's package.json declares "type": "module".
 */

import http from 'node:http';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const LLAMA_API_URL = (process.env.LLAMA_API_URL || 'http://127.0.0.1:8080/v1').replace(/\/+$/, '');
const PORT = Number(process.env.PORT || 1234);
const HOST = process.env.HOST || '127.0.0.1';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 32 * 1024 * 1024);

function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (ALLOWED_ORIGIN !== '*') res.setHeader('Vary', 'Origin');
}

function sendJson(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
    });
    res.end(body);
}

/** Collect a request body, refusing anything implausibly large. */
function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', chunk => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(Object.assign(new Error('Request body too large'), { statusCode: 413 }));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

/** Forward a request upstream and stream the response straight back. */
async function proxy(req, res, targetPath) {
    let body;
    try {
        body = req.method === 'POST' ? await readBody(req) : undefined;
    } catch (err) {
        sendJson(res, err.statusCode || 400, { error: { message: err.message } });
        return;
    }

    const headers = { 'Content-Type': 'application/json' };
    // Pass the key through untouched: local engines usually ignore it, but
    // some sit behind an auth proxy that does not.
    if (req.headers.authorization) headers.Authorization = req.headers.authorization;

    const controller = new AbortController();
    // If the browser gives up (the user pressed Stop), stop generating too
    // instead of leaving the engine burning compute on an unread response.
    res.on('close', () => controller.abort());

    let upstream;
    try {
        upstream = await fetch(`${LLAMA_API_URL}${targetPath}`, {
            method: req.method,
            headers,
            body,
            signal: controller.signal
        });
    } catch (err) {
        if (err.name === 'AbortError') return;
        console.error(`[bridge] upstream request failed: ${err.message}`);
        if (!res.headersSent) {
            sendJson(res, 502, {
                error: {
                    message: `Could not reach the local engine at ${LLAMA_API_URL}. Is it running? (${err.message})`
                }
            });
        }
        return;
    }

    res.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') || 'application/json',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        // Buffering proxies break SSE by holding chunks until the stream ends.
        'X-Accel-Buffering': 'no'
    });

    if (!upstream.body) {
        res.end();
        return;
    }

    try {
        // pipeline() applies backpressure and propagates errors, which the
        // original hand-rolled recursive pump did neither of.
        await pipeline(Readable.fromWeb(upstream.body), res);
    } catch (err) {
        if (err.name === 'AbortError' || err.code === 'ERR_STREAM_PREMATURE_CLOSE') return;
        console.error(`[bridge] stream relay failed: ${err.message}`);
        res.destroy(err);
    }
}

/** Ask the engine for its model list; synthesise one if it has no endpoint. */
async function handleModels(req, res) {
    try {
        const upstream = await fetch(`${LLAMA_API_URL}/models`, {
            headers: req.headers.authorization ? { Authorization: req.headers.authorization } : {}
        });
        if (upstream.ok) {
            const data = await upstream.json();
            if (Array.isArray(data?.data) && data.data.length > 0) {
                sendJson(res, 200, data);
                return;
            }
        }
    } catch {
        // Falls through to the synthesised list below.
    }

    // llama-server builds without a /models route still serve completions for
    // whichever model was loaded at startup, so advertise exactly that.
    sendJson(res, 200, {
        object: 'list',
        data: [{
            id: 'local-model',
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: 'local'
        }]
    });
}

const server = http.createServer((req, res) => {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const path = (req.url || '').split('?')[0].replace(/\/+$/, '') || '/';

    if (path === '/v1/models' && req.method === 'GET') {
        handleModels(req, res).catch(err => {
            console.error('[bridge] models handler failed', err);
            if (!res.headersSent) sendJson(res, 500, { error: { message: err.message } });
        });
        return;
    }

    if (path === '/v1/chat/completions' && req.method === 'POST') {
        proxy(req, res, '/chat/completions').catch(err => {
            console.error('[bridge] chat handler failed', err);
            if (!res.headersSent) sendJson(res, 500, { error: { message: err.message } });
        });
        return;
    }

    if (path === '/v1/completions' && req.method === 'POST') {
        proxy(req, res, '/completions').catch(err => {
            console.error('[bridge] completions handler failed', err);
            if (!res.headersSent) sendJson(res, 500, { error: { message: err.message } });
        });
        return;
    }

    if (path === '/v1/embeddings' && req.method === 'POST') {
        proxy(req, res, '/embeddings').catch(err => {
            console.error('[bridge] embeddings handler failed', err);
            if (!res.headersSent) sendJson(res, 500, { error: { message: err.message } });
        });
        return;
    }

    if (path === '/health' || path === '/') {
        sendJson(res, 200, { status: 'ok', upstream: LLAMA_API_URL });
        return;
    }

    sendJson(res, 404, { error: { message: `No route for ${req.method} ${path}` } });
});

server.on('clientError', (err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

server.listen(PORT, HOST, () => {
    console.log(`Aspect Studio bridge listening on http://${HOST}:${PORT}`);
    console.log(`Proxying to ${LLAMA_API_URL}`);
    console.log(`In Aspect Studio, set the endpoint URL to http://localhost:${PORT}/v1`);
});

const shutdown = () => {
    console.log('\nShutting down bridge…');
    server.close(() => process.exit(0));
    // Do not hang forever on a client holding a stream open.
    setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
