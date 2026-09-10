/**
 * git-bridge/server.js
 *
 * Lightweight HTTP bridge that exposes read-only git inspection endpoints to
 * Aspect Studio's GitInspector tool.  No npm dependencies — built-ins only.
 *
 * Endpoints
 *   GET /health              → { ok: true }
 *   GET /status?repo=<path>  → { branch, files: [{xy, path}] }
 *   GET /diff?repo=<path>[&file=<rel>] → { diff }
 *   GET /log?repo=<path>[&n=<num>]     → [ { hash, message }, … ]
 *
 * Environment variables
 *   GIT_BRIDGE_PORT   Listening port  (default: 7432)
 */

'use strict';

const http = require('http');
const { execFile } = require('child_process');
const fs = require('fs');
const { URL } = require('url');

const PORT = parseInt(process.env.GIT_BRIDGE_PORT || '7432', 10);

// ---------------------------------------------------------------------------
// Security helpers
// ---------------------------------------------------------------------------

/** Characters that are meaningful to shells — reject any path containing them. */
const SHELL_METACHARACTER_RE = /[;&|`$<>!\\'"()\n\r\t\0]/;

/**
 * Validate a repo path argument.
 * @param {string|null} repo
 * @returns {{ valid: false, reason: string } | { valid: true, path: string }}
 */
function validateRepoPath(repo) {
    if (!repo || typeof repo !== 'string') {
        return { valid: false, reason: "'repo' query parameter is required" };
    }
    if (SHELL_METACHARACTER_RE.test(repo)) {
        return { valid: false, reason: "'repo' path contains disallowed characters" };
    }
    if (!fs.existsSync(repo)) {
        return { valid: false, reason: `Path does not exist: ${repo}` };
    }
    return { valid: true, path: repo };
}

/**
 * Validate an optional file path argument (relative path within repo).
 * @param {string|null|undefined} file
 * @returns {{ valid: false, reason: string } | { valid: true, file: string|null }}
 */
function validateFilePath(file) {
    if (!file) return { valid: true, file: null };
    if (typeof file !== 'string') return { valid: false, reason: "'file' must be a string" };
    if (SHELL_METACHARACTER_RE.test(file)) {
        return { valid: false, reason: "'file' path contains disallowed characters" };
    }
    // Disallow absolute paths for the file argument — it must be relative
    if (file.startsWith('/')) {
        return { valid: false, reason: "'file' must be a relative path" };
    }
    return { valid: true, file };
}

// ---------------------------------------------------------------------------
// Git helpers — all use execFile to prevent shell injection
// ---------------------------------------------------------------------------

/**
 * Run a git command in a given working directory.
 * @param {string} cwd
 * @param {string[]} args
 * @param {number} [timeoutMs=10000]
 * @returns {Promise<string>}
 */
function runGit(cwd, args, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        execFile('git', args, { cwd, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
                reject(new Error(stderr.trim() || err.message));
            } else {
                resolve(stdout);
            }
        });
    });
}

/**
 * GET /status — branch name + porcelain file status list.
 */
async function handleStatus(repo) {
    const [porcelain, branchRaw] = await Promise.all([
        runGit(repo, ['status', '--porcelain=v1']),
        runGit(repo, ['branch', '--show-current']),
    ]);

    const branch = branchRaw.trim();

    const files = porcelain
        .split('\n')
        .filter(Boolean)
        .map(line => ({
            xy: line.slice(0, 2),
            path: line.slice(3),
        }));

    return { branch, files };
}

/**
 * GET /diff — unified diff against HEAD, optionally scoped to a file.
 */
async function handleDiff(repo, file) {
    const args = file
        ? ['diff', 'HEAD', '--', file]
        : ['diff', 'HEAD'];
    const diff = await runGit(repo, args);
    return { diff };
}

/**
 * GET /log — one-line commit log, limited to n entries.
 */
async function handleLog(repo, n) {
    const count = Math.min(Math.max(parseInt(n, 10) || 10, 1), 200);
    const output = await runGit(repo, ['log', '--oneline', `-${count}`]);
    const commits = output
        .split('\n')
        .filter(Boolean)
        .map(line => {
            const spaceIdx = line.indexOf(' ');
            return {
                hash: line.slice(0, spaceIdx),
                message: line.slice(spaceIdx + 1),
            };
        });
    return commits;
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

/** Write a JSON response. */
function sendJSON(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end(payload);
}

const server = http.createServer(async (req, res) => {
    // Parse URL — use a dummy base so relative paths parse correctly
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname;

    // Preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        });
        res.end();
        return;
    }

    if (req.method !== 'GET') {
        sendJSON(res, 405, { error: 'Method not allowed' });
        return;
    }

    try {
        // ------------------------------------------------------------------
        // GET /health
        // ------------------------------------------------------------------
        if (pathname === '/health') {
            sendJSON(res, 200, { ok: true });
            return;
        }

        // ------------------------------------------------------------------
        // GET /status
        // ------------------------------------------------------------------
        if (pathname === '/status') {
            const repo = url.searchParams.get('repo');
            const check = validateRepoPath(repo);
            if (!check.valid) {
                sendJSON(res, 400, { error: check.reason });
                return;
            }
            const result = await handleStatus(check.path);
            sendJSON(res, 200, result);
            return;
        }

        // ------------------------------------------------------------------
        // GET /diff
        // ------------------------------------------------------------------
        if (pathname === '/diff') {
            const repo = url.searchParams.get('repo');
            const repoCheck = validateRepoPath(repo);
            if (!repoCheck.valid) {
                sendJSON(res, 400, { error: repoCheck.reason });
                return;
            }

            const fileParam = url.searchParams.get('file');
            const fileCheck = validateFilePath(fileParam);
            if (!fileCheck.valid) {
                sendJSON(res, 400, { error: fileCheck.reason });
                return;
            }

            const result = await handleDiff(repoCheck.path, fileCheck.file);
            sendJSON(res, 200, result);
            return;
        }

        // ------------------------------------------------------------------
        // GET /log
        // ------------------------------------------------------------------
        if (pathname === '/log') {
            const repo = url.searchParams.get('repo');
            const repoCheck = validateRepoPath(repo);
            if (!repoCheck.valid) {
                sendJSON(res, 400, { error: repoCheck.reason });
                return;
            }

            const n = url.searchParams.get('n') || '10';
            const result = await handleLog(repoCheck.path, n);
            sendJSON(res, 200, result);
            return;
        }

        // Unknown path
        sendJSON(res, 404, { error: `Unknown endpoint: ${pathname}` });

    } catch (err) {
        // Git command failures (e.g. not a git repo) surface here
        const message = err.message || 'Internal error';
        const isGitError = message.includes('not a git') || message.includes('fatal:');
        sendJSON(res, isGitError ? 422 : 500, { error: message });
    }
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`git-bridge listening on http://127.0.0.1:${PORT}`);
});

server.on('error', err => {
    console.error('git-bridge error:', err.message);
    process.exit(1);
});
