import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, realpath } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), 'dist'));
const port = Number(process.env.ASPECT_CHAT_PORT || 43110);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('ASPECT_CHAT_PORT must be an integer from 1 to 65535');
}
const url = `http://localhost:${port}/`;
const types = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json', '.wasm': 'application/wasm',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
    '.woff': 'font/woff', '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    // Restrict Host as well as the listening interface to prevent DNS rebinding.
    if (![ `localhost:${port}`, `127.0.0.1:${port}` ].includes(req.headers.host)) {
        res.writeHead(403).end();
        return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405, { Allow: 'GET, HEAD' }).end();
        return;
    }
    try {
        const pathname = decodeURIComponent(new URL(req.url, url).pathname);
        const file = await realpath(resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`));
        if (!file.startsWith(root + sep)) {
            res.writeHead(403).end();
            return;
        }
        const info = await stat(file);
        if (!info.isFile()) {
            res.writeHead(404).end();
            return;
        }
        res.writeHead(200, {
            'Content-Type': types[extname(file)] || 'application/octet-stream',
            'Content-Length': info.size,
            'Cache-Control': 'no-cache',
        });
        if (req.method === 'HEAD') res.end();
        else createReadStream(file).on('error', () => res.destroy()).pipe(res);
    } catch (error) {
        res.writeHead(error instanceof URIError ? 400 : 404).end();
    }
});

server.on('error', error => {
    console.error(error.code === 'EADDRINUSE'
        ? `Port ${port} is already in use. Stop the existing server or set ASPECT_CHAT_PORT.`
        : error.message);
    process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
    console.log(`Aspect Studio: ${url}\nPress Ctrl+C to stop.`);
    if (process.argv.includes('--open')) {
        const command = process.platform === 'darwin' ? ['open', url]
            : process.platform === 'win32' ? ['explorer.exe', url] : ['xdg-open', url];
        const child = spawn(command[0], command.slice(1), { stdio: 'ignore' });
        child.on('error', () => console.log(`Open ${url} in your browser.`));
        child.unref();
    }
});
for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => { server.close(); server.closeAllConnections(); });
}
