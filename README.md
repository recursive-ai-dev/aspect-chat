# Aspect Studio 🌸

Custom AI personas — **Aspects** — that run against your own models. Think Gemini Gems,
but pointed at Ollama, LM Studio, llama.cpp, or an in-browser model, with no account,
no telemetry, and no cloud round-trip unless you ask for one.

Everything lives in your browser. Aspects are exportable as self-contained `.aspect`
files you can back up, version, or hand to someone else.

---

## Quick start

To run a packaged build without a source checkout, see
[Production packages](#production-packages). To run from source, use Node.js 24
and npm (Node.js 22.13+ is also supported by the installed build/test tools):

```bash
git clone https://github.com/recursive-ai-dev/aspect-chat.git
cd aspect-chat
npm ci
npm run dev          # http://localhost:5173/
```

Then click **⚙️ API Settings** and choose your provider.

### With Ollama

```bash
OLLAMA_ORIGINS="*" ollama serve
ollama pull llama3.1:8b
```

In Aspect Studio pick **Ollama (local)**. The URL fills in, the API key field
disappears (local servers do not use one), and the model dropdown populates from
your installed models. Hit **Test connection** if anything looks wrong to check
model discovery and see connection errors. Browser network errors can indicate
either an unreachable server or a CORS problem.

> `OLLAMA_ORIGINS` matters. Without it Ollama answers `curl` but refuses the
> browser, and the failure looks exactly like the server being down.

### With LM Studio

Open the **Developer / Local Server** tab, load a model, start the server, and
enable CORS. Then pick **LM Studio (local)** in Aspect Studio.

### With llama.cpp, vLLM, KoboldCpp

Pick the matching entry, or **Custom** with any OpenAI-compatible base URL ending
in `/v1`. If the engine cannot send CORS headers itself, run the bundled bridge:

```bash
cd llama-bridge
LLAMA_API_URL=http://127.0.0.1:8080/v1 node server.js
```

…then point Aspect Studio at `http://localhost:1234/v1`. See
[`llama-bridge/README.md`](llama-bridge/README.md).

### With no server at all

Pick **WebLLM (in-browser, no server)** and choose a model. It runs in the tab via
WebGPU; the first use downloads the weights (typically 1–4 GB) and caches them.
Needs a recent Chrome, Edge, or other Chromium-based browser.

### With a hosted provider

OpenAI, Groq, Cerebras, OpenRouter, Mistral, DeepSeek, Cohere, ArliAI and Gemini's
OpenAI-compatible endpoint are all in the provider list. These do need an API key.

For local models, the packaged server uses `http://localhost:43110/`.
If a hosted copy cannot reach your local engine, check the connection diagnostics
in API Settings and the engine's CORS configuration, or run the app locally.

---

## Aspects

An Aspect is a persona plus everything it needs to be useful:

| Piece | What it does |
|---|---|
| **Instructions** | The system prompt, sent before every response. |
| **Knowledge bank** | Markdown notes and attached `.txt` / `.md` / `.pdf` / `.docx` files, with relevant chunks retrieved for each query. |
| **Tools** | JavaScript you write, executed in a sandboxed cross-origin iframe when the model asks for it. |
| **Memory** | Key-value store that persists across conversations via `ReadMemory` / `WriteMemory`. |
| **Generation settings** | Per-Aspect temperature, top-p, and max response tokens. |
| **Conversations** | Multiple named chats per Aspect, auto-titled from the first message. |

**Basic mode** builds the prompt from a description and a tone slider.
**Advanced mode** gives you the raw prompt, generation settings, knowledge, and tools.
An Aspect whose prompt was hand-written always opens in Advanced, and switching it
down to Basic asks first — Basic cannot represent an arbitrary prompt, and silently
flattening one would lose your work.

### Knowledge retrieval and context

In **API Settings**, **Retrieve relevant knowledge chunks** selects passages from
your notes and attached files instead of including all knowledge in every request.
It is enabled by default and selects four chunks per query; you can choose 1–10.
Turn it off to include knowledge without retrieval, subject to the app's
knowledge-length limit.

Semantic retrieval runs MiniLM embeddings in a browser worker and caches document
vectors in IndexedDB. **Allow initial embedding model download** is off by default.
Without an available model, retrieval falls back to keyword matching. Enabling
downloads fetches model files; it does not upload documents to the embedding
service. Selected knowledge is still sent to the chat provider you configure.
For a locally served model, place its files under
`models/Xenova/all-MiniLM-L6-v2/` relative to the app's web root (`public/models/`
before building, or `dist/models/` in an extracted package).

Set **Model context window (tokens)** to match your inference engine. The app
warns when estimated input plus response tokens approaches that limit; this is an
estimate, not automatic context resizing. **Max context messages** separately
limits conversation history.

### Tools

A tool defines an `executeTool` function:

```js
// Usage: executeTool({ city: "Kyoto" })
async function executeTool(args, state) {
    // `state` persists between calls on this Aspect.
    state.callCount = (state.callCount || 0) + 1;
    return { city: args.city, calls: state.callCount };
}
```

Tools support native function calls and text markers such as
`[Run Tool: Weather.js({"city":"Kyoto"})]`. In API Settings, choose automatic
provider selection, force native functions for a compatible model, or use text
markers for legacy models. The result is fed back and the model continues.

Tools run inside a `sandbox="allow-scripts"` iframe with a unique opaque origin:
no `window`/`document` of the app, no cookies, and `localStorage` / `indexedDB`
are unreachable — so a tool cannot read your Aspects, conversations, memory, or
API key. Its Content-Security-Policy blocks the network outright; a tool reaches
`fetch` only through a broker that asks you the first time and remembers the
answer per tool (change it any time from the tool's **Network** button in the
editor). `XMLHttpRequest`, `WebSocket`, and `EventSource` are disabled.

You should still read tool code before enabling it — a tool you allow network
access to can send whatever it's given anywhere. There is a loop guard at 15
consecutive tool runs and a configurable per-tool timeout (30s by default).

Built-in tools: Calculator, Weather, DateTime, ReadMemory, WriteMemory,
MemoryWatch, SummonAspect, RegexTester, ASTParser, CanvasRenderer, and GitInspector.
GitInspector requires the optional [local git bridge](git-bridge/README.md).

### Talking to other Aspects

Start a message with `@AspectName` to ask another Aspect a question and fold its
answer back into the current conversation. Tools can do the same via `SummonAspect`.

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Enter` | Send (`Shift+Enter` for a newline) |
| `Ctrl/Cmd + K` | New chat |
| `Ctrl/Cmd + E` | Toggle chat ⇄ editor |
| `Ctrl/Cmd + S` | Export the current Aspect |
| `Ctrl/Cmd + ,` | API settings |
| `Esc` | Close the topmost modal |

---

## Where your data lives

| Data | Storage |
|---|---|
| Aspects, conversations, tools, icons | IndexedDB (`AspectKnowledgeDB`) |
| Knowledge files and Aspect memory | IndexedDB |
| Knowledge vectors and automatic library snapshots | IndexedDB |
| Provider settings, theme, API key | `localStorage` |

Aspects moved from `localStorage` to IndexedDB because the ~5 MB quota was easy to
exceed once chat history and a base64 background were in the same blob — and the
overflow failed silently. Existing libraries migrate automatically on first load,
and the original blob is kept under `aspects_data_v1_backup` rather than deleted.

The API key is remembered by default so you are not retyping it on every reload.
Turn off **Remember API key** in Settings to keep it for the current tab only.
See [`SECURITY.md`](SECURITY.md).

### Backups

Browser storage is not a backup. **💾 Export .aspect** writes a zip containing the
name, description, instructions, knowledge, tools (with their state), memory, icon,
background, generation settings, and every conversation. **🌐 Export webpage** writes
a standalone HTML card for sharing.

API Settings also offers **Export all Aspects**, **Import Aspects file**, and
automatic timestamped library snapshots. Library imports merge Aspects as new
copies; restoring a snapshot replaces the current Aspect library and first saves
a pre-restore snapshot. Library JSON exports and snapshots store Aspect records;
use individual `.aspect` exports to include separately stored knowledge file
contents. Automatic snapshots remain in the same browser and do not replace an
external backup.

---

## Fallback provider

Configure a second provider used automatically when the first one fails — the
common setup being a hosted model as primary with WebLLM as the offline fallback.
When it kicks in, the chat says which provider answered and why. A user-initiated
**Stop** is never retried on the fallback.

---

## Production packages

### Build packages

```bash
npm ci
npm run package       # portable ZIP + Debian/Ubuntu .deb (requires dpkg-deb)
npm run package:web   # portable ZIP only; works on Windows, macOS, and Linux
npm run package:deb   # Debian/Ubuntu package only; requires dpkg-deb
```

Each command builds fresh production assets and writes versioned packages and
SHA-256 checksum files to `release/`. Build with Node.js 24 or 22.13+.
The ZIP contains `dist/`, a dependency-free local server, instructions, and the
license. These are browser-app packages; they do not bundle Node.js or a browser.

### Run the portable ZIP

Extract `aspect-chat-1.0.0-web.zip`, open a terminal in the extracted
`aspect-chat-1.0.0` directory, and run:

```bash
node server.mjs --open
```

The packaged server requires Node.js 20.19+.
No source checkout or `npm install` is needed to run a package. For static web
hosting, deploy the ZIP's `dist/` contents instead.

### Install on Debian or Ubuntu

```bash
sudo apt install ./release/aspect-chat-1.0.0_all.deb
```

Adjust the path and version if you downloaded the package elsewhere.
It requires Node.js 20.19+ and `xdg-utils`; a compatible Node.js package must be
installed or available from your configured apt repositories.
Launch **Aspect Studio** from the application menu or run
`/usr/bin/aspect-chat --open`. The terminal stays open while serving the app;
press Ctrl+C to stop. If you previously installed checkout-based desktop
integration, run `npm run desktop:uninstall` first to remove its user-level
launcher and menu entry.

The packaged server listens only on `127.0.0.1`, using
`http://localhost:43110/` by default. Set `ASPECT_CHAT_PORT` to change the port.
Keep the same hostname and port to access the same browser-stored library;
export/import your Aspects when moving between origins. Packages do not include
model weights, model servers, or the optional bridges. Keep the terminal open
while using the app. If the port is occupied, stop the existing server before
launching another copy, or select a different port.

### Verify packages and build in CI

On Linux, verify downloaded artifacts from the directory containing both the
packages and their checksum files (adjust versions as needed):

```bash
sha256sum -c aspect-chat-1.0.0-web.zip.sha256
sha256sum -c aspect-chat-1.0.0_all.deb.sha256
```

The **Production packages** GitHub Actions workflow runs tests and builds both
packages on manual dispatch or a `v<package.json version>` tag. Download the
`aspect-chat-packages` artifact from the workflow run. It does not publish a
GitHub Release automatically.

## Development

```bash
npm run dev           # dev server
npm test              # application tests
npm run test:packaging # packaged server checks
npm run build         # production build to dist/
npm run preview       # preview the build locally
```

For Linux desktop integration tied to a source checkout, run `npm run build`
followed by `npm run desktop:install`. Keep the checkout in place; this launcher
serves its `dist/` directory. Remove that integration with
`npm run desktop:uninstall`. For a distributable installation, use the `.deb`
package instead.

Vanilla JavaScript ES modules, no framework. Vite for bundling, Vitest + jsdom +
MSW for tests, CodeMirror 6 for the tool editor, marked + DOMPurify for rendering.

```
src/js/modules/
  providers.js        Provider catalogue, local-endpoint detection, connection test
  llm.js              Streaming transport (HTTP + WebLLM) and fallback
  webllm.js           In-browser engine lifecycle
  retrieval.js        Knowledge chunk ranking and cached document vectors
  embeddingWorker.js  Local MiniLM embeddings via Transformers.js and ONNX
  contextBudget.js    Estimated input/output context-window warnings
  conversations.js    Per-Aspect conversation model
  persist.js          IndexedDB storage and localStorage migration
  idb.js              Shared database connection
  aspects.js          Aspect CRUD, cloning, templates, normalization
  tools.js            Chat loop, tool execution orchestration, logging
  chat.js             Message rendering, markdown sanitization, bubble actions
  ui.js               Views, editor, conversation list, preset backgrounds
  settings.js         Settings modal, model fetching, API configuration
  backup.js           Full library export/import and automatic snapshots
  db.js               IndexedDB file storage for knowledge files and memory
  imagegen.js         In-browser / remote aspect avatar generation
  init.js             Application bootstrapper and storage error recovery
  state.js            Centralized reactive state store and debounced persistence
  systemTools.js      Built-in tool definitions (Calculator, Weather, DateTime, Memory, SummonAspect)
  themes.js           Theme definitions and active theme switcher
  toolEditor.js       CodeMirror 6 tool authoring environment
  toolSandbox.js      Hardened iframe sandbox and broker for tool execution
  sandboxBootstrap.js Isolated tool runtime used by the sandbox document
  workflowBuilder.js  Visual tool node flow editor
  zip.js              JSZip packaging for .aspect bundles and standalone webpage exporter
```

Fonts are bundled via `@fontsource` rather than fetched from a CDN — a local-first
app has to render correctly with no network.

---

Apache-2.0. Built in pure HTML, CSS, and vanilla JavaScript.
