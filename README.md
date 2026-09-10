# Aspect Studio 🌸

Custom AI personas — **Aspects** — that run against your own models. Think Gemini Gems,
but pointed at Ollama, LM Studio, llama.cpp, or an in-browser model, with no account,
no telemetry, and no cloud round-trip unless you ask for one.

Everything lives in your browser. Aspects are exportable as self-contained `.aspect`
files you can back up, version, or hand to someone else.

---

## Quick start

```bash
npm install
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
your installed models. Hit **Test connection** if anything looks wrong — it will
tell you whether the server is unreachable or reachable-but-blocking-CORS, which
the browser otherwise reports identically.

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

> **Serve over `http://`, not `https://`, when using local models.** A page loaded
> over HTTPS cannot make plain-HTTP requests to `localhost`; browsers block it as
> mixed content. Aspect Studio detects this and says so in Settings.

---

## Aspects

An Aspect is a persona plus everything it needs to be useful:

| Piece | What it does |
|---|---|
| **Instructions** | The system prompt, sent before every response. |
| **Knowledge bank** | Markdown notes, plus attached `.txt` / `.md` / `.pdf` / `.docx` files, injected into context. |
| **Tools** | JavaScript you write, executed in a sandboxed cross-origin iframe when the model asks for it. |
| **Memory** | Key-value store that persists across conversations via `ReadMemory` / `WriteMemory`. |
| **Generation settings** | Per-Aspect temperature, top-p, and max response tokens. |
| **Conversations** | Multiple named chats per Aspect, auto-titled from the first message. |

**Basic mode** builds the prompt from a description and a tone slider.
**Advanced mode** gives you the raw prompt, generation settings, knowledge, and tools.
An Aspect whose prompt was hand-written always opens in Advanced, and switching it
down to Basic asks first — Basic cannot represent an arbitrary prompt, and silently
flattening one would lose your work.

### Tools

A tool is a module exporting `executeTool`:

```js
// Usage: executeTool({ city: "Kyoto" })
async function executeTool(args, state) {
    // `state` persists between calls on this Aspect.
    state.callCount = (state.callCount || 0) + 1;
    return { city: args.city, calls: state.callCount };
}
```

The model invokes it by writing `[Run Tool: Weather.js({"city":"Kyoto"})]`. The
result is fed back and the model continues.

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

Built-in tools: Calculator, Weather, DateTime, ReadMemory, WriteMemory, SummonAspect.

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

---

## Fallback provider

Configure a second provider used automatically when the first one fails — the
common setup being a hosted model as primary with WebLLM as the offline fallback.
When it kicks in, the chat says which provider answered and why. A user-initiated
**Stop** is never retried on the fallback.

---

## Development

```bash
npm run dev       # dev server
npm test          # 410 tests (22 test suites)
npm run build     # production build to dist/
npm run preview   # serve the build
```

Vanilla JavaScript ES modules, no framework. Vite for bundling, Vitest + jsdom +
MSW for tests, CodeMirror 6 for the tool editor, marked + DOMPurify for rendering.

```
src/js/modules/
  providers.js        Provider catalogue, local-endpoint detection, connection test
  llm.js              Streaming transport (HTTP + WebLLM) and fallback
  webllm.js           In-browser engine lifecycle
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
  workflowBuilder.js  Visual tool node flow editor
  zip.js              JSZip packaging for .aspect bundles and standalone webpage exporter
```

Fonts are bundled via `@fontsource` rather than fetched from a CDN — a local-first
app has to render correctly with no network.

---

Apache-2.0. Built in pure HTML, CSS, and vanilla JavaScript.
