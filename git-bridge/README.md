# git-bridge

A tiny, zero-dependency Node.js HTTP server that exposes read-only git
inspection endpoints to Aspect Studio's **GitInspector** built-in tool.

---

## What it does

The bridge runs git commands on your machine and returns JSON over HTTP so
that the GitInspector tool (running inside the browser sandbox) can inspect
local repositories without needing direct filesystem access.

All commands are **read-only** — no writes, no checkouts, no network git
operations are ever performed.

---

## Quick start

```bash
cd git-bridge
node server.js
# → git-bridge listening on http://127.0.0.1:7432
```

No `npm install` needed — the server uses Node.js built-ins only.

---

## Environment variables

| Variable          | Default | Description                        |
|-------------------|---------|------------------------------------|
| `GIT_BRIDGE_PORT` | `7432`  | TCP port the server listens on.    |

Example:

```bash
GIT_BRIDGE_PORT=8000 node server.js
```

---

## Endpoints

All responses are `application/json` with `Access-Control-Allow-Origin: *`.

### `GET /health`

Returns `{ "ok": true }`. Use this to check that the bridge is running.

### `GET /status?repo=/absolute/path/to/repo`

Returns the current branch and working-tree status.

```json
{
  "branch": "main",
  "files": [
    { "xy": " M", "path": "src/foo.js" },
    { "xy": "??", "path": "scratch.txt" }
  ]
}
```

`xy` is the two-character porcelain status code (`git status --porcelain=v1`).

### `GET /diff?repo=/path/to/repo[&file=relative/path.js]`

Returns the unified diff of all unstaged + staged changes against HEAD, or
just the named file if `file` is supplied.

```json
{ "diff": "diff --git a/src/foo.js …\n…" }
```

### `GET /log?repo=/path/to/repo[&n=10]`

Returns the last `n` commits (default 10, max 200).

```json
[
  { "hash": "a1b2c3d", "message": "fix: handle empty diff" },
  { "hash": "e4f5a6b", "message": "feat: add log endpoint" }
]
```

---

## Security notes

- The server binds to **`127.0.0.1` only** — it is not reachable from other
  machines on the network.
- Every `repo` path is validated with `fs.existsSync` before any git command
  runs. Paths containing shell metacharacters (`;`, `|`, `$`, backticks, etc.)
  are rejected with HTTP 400.
- All git commands use `child_process.execFile` with an explicit argument
  array — no shell interpolation is possible.
- The `file` parameter for `/diff` must be a relative path; absolute paths are
  rejected.
- Only `GET` and `OPTIONS` requests are accepted; everything else gets HTTP 405.
- Commands time out after 10 seconds and are limited to a 4 MB output buffer.

You should still only run this bridge while actively using GitInspector, and
stop it when done.
