# Aspect Studio local bridge

A small reverse proxy between the browser and a local inference server
(llama.cpp, Ollama, LM Studio, vLLM, KoboldCpp…).

## When you need it

Aspect Studio talks to local engines directly, so most of the time you do not.
Reach for the bridge when:

- **The engine will not send CORS headers.** The browser refuses to read a
  cross-origin response without them, and the failure looks identical to the
  server being down. This is the usual reason.
- **The engine has no `/v1/models` endpoint.** Some `llama.cpp` builds do not,
  which leaves Aspect Studio's model dropdown empty. The bridge synthesises a
  single-entry list so the dropdown populates.
- **You want one stable URL** in front of engines you switch between.

If you use Ollama, try `OLLAMA_ORIGINS="*" ollama serve` first — it solves the
same problem with no extra process.

## Usage

Start your engine, for example:

```bash
llama-server -m your_model.gguf -c 8192 --host 127.0.0.1 --port 8080
```

Then run the bridge:

```bash
node server.js
```

In Aspect Studio, set the endpoint URL to `http://localhost:1234/v1`.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `LLAMA_API_URL` | `http://127.0.0.1:8080/v1` | Upstream engine base URL |
| `PORT` | `1234` | Port the bridge listens on |
| `HOST` | `127.0.0.1` | Interface to bind. Use `0.0.0.0` only on a network you trust — the bridge performs no authentication of its own. |
| `ALLOWED_ORIGIN` | `*` | Value for `Access-Control-Allow-Origin`. Set it to your Aspect Studio origin to narrow it. |
| `MAX_BODY_BYTES` | `33554432` | Request body ceiling (32 MB) |

```bash
PORT=9090 LLAMA_API_URL=http://localhost:11434/v1 node server.js
```

## Routes

| Route | Behaviour |
|---|---|
| `GET /health` | `{ status, upstream }` — confirms the bridge is up and where it points |
| `GET /v1/models` | Proxied; falls back to a synthesised single-model list |
| `POST /v1/chat/completions` | Proxied, streaming preserved |
| `POST /v1/completions` | Proxied |
| `POST /v1/embeddings` | Proxied |

## Notes

- Requires Node 18+ (it uses the global `fetch` and web streams).
- Uses ES module syntax, matching the repository's `"type": "module"`.
- Streaming uses `stream.pipeline`, so backpressure is respected and a broken
  connection surfaces as an error instead of an unhandled rejection.
- Closing the browser tab aborts the upstream request rather than leaving the
  engine generating into a response nobody will read.
- `Authorization` headers are passed through untouched, for engines behind an
  auth proxy.
