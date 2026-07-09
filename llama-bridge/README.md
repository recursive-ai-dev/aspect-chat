# Llama.cpp / GGUF Bridge Server

This is a lightweight Node.js proxy server designed to bridge the gap between Aspect Studio and a local `llama.cpp` server (or any other local engine like LM Studio, Ollama, etc. that might need slight API adaptations).

## Purpose

While Aspect Studio can connect directly to OpenAI-compatible endpoints (like LM Studio on `http://localhost:1234/v1`), this bridge provides a guaranteed way to adapt pure `llama.cpp` server endpoints to fully match the expected structure, handle CORS issues seamlessly, and provide mock `/models` responses if the underlying server lacks them.

## Usage

1. Start your `llama.cpp` server (e.g., using `llama-server` from the official repository). By default, it runs on `http://127.0.0.1:8080`.

   ```bash
   ./llama-server -m your_model.gguf -c 2048 --host 127.0.0.1 --port 8080
   ```

2. Run this bridge server:

   ```bash
   node server.js
   ```

3. In Aspect Studio, go to Settings, choose `Local / Network-Agnostic` (or `Custom`), and set the URL to `http://localhost:1234/v1`.

## Configuration

You can override the target URL or the port using environment variables:

- `LLAMA_API_URL` (default: `http://127.0.0.1:8080/v1`)
- `PORT` (default: `1234`)

Example:
```bash
PORT=9090 LLAMA_API_URL=http://localhost:11434/v1 node server.js
```
