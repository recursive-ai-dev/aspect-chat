import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, request } from 'node:http';

test('packaged server serves assets and blocks paths outside dist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aspect-server-test-'));
    let child;
    try {
        await mkdir(join(dir, 'dist'));
        await writeFile(join(dir, 'dist/index.html'), '<h1>Packaged app</h1>');
        await writeFile(join(dir, 'dist/model.wasm'), 'wasm');
        await writeFile(join(dir, 'secret'), 'private');
        await symlink(join(dir, 'secret'), join(dir, 'dist/escape'));
        await cp(new URL('../packaging/server.mjs', import.meta.url), join(dir, 'server.mjs'));
        const probe = createServer();
        probe.listen(0, '127.0.0.1');
        await once(probe, 'listening');
        const port = probe.address().port;
        await new Promise(resolve => probe.close(resolve));
        child = spawn(process.execPath, [join(dir, 'server.mjs')], {
            env: { ...process.env, ASPECT_CHAT_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
        });
        await Promise.race([
            once(child.stdout, 'data'),
            once(child, 'exit').then(([code]) => { throw new Error(`Server exited: ${code}`); }),
            new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Startup timed out')), 5000); timer.unref(); }),
        ]);
        const get = (path, options = {}) => new Promise((resolve, reject) => {
            const req = request({ hostname: '127.0.0.1', port, path, ...options }, res => {
                let body = '';
                res.on('data', data => { body += data; });
                res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
            });
            req.on('error', reject);
            req.end();
        });
        assert.equal((await get('/')).body, '<h1>Packaged app</h1>');
        assert.equal((await get('/model.wasm')).headers['content-type'], 'application/wasm');
        assert.equal((await get('/', { method: 'HEAD' })).body, '');
        assert.equal((await get('/', { method: 'POST' })).status, 405);
        assert.equal((await get('/', { headers: { host: 'attacker.example' } })).status, 403);
        assert.equal((await get('/escape')).status, 403);
        assert.notEqual((await get('/%2e%2e%2fsecret')).status, 200);
        assert.equal((await get('/%ZZ')).status, 400);
        assert.equal((await get('/missing.js')).status, 404);
    } finally {
        if (child && child.exitCode === null) {
            const exited = once(child, 'exit');
            child.kill();
            await exited;
        }
        await rm(dir, { recursive: true, force: true });
    }
});
