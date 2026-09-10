# FEATURE_ROADMAP.md: Core Capability & Systems Enhancements

This document specifies architectural and user-facing feature additions to expand Aspect Studio from a single-turn prompt/tool harness into a more capable, autonomous local-first workspace.

---

### 1. Dedicated Worker Pool for Concurrency & Isolation

Currently, `executeJavaScriptTool` spawns and tears down an ephemeral `about:srcdoc` iframe per execution. Under rapid multi-tool chains or multi-agent calls (`SummonAspect`), DOM thrashing and layout recalc degrade UI responsiveness.

* **Pre-warmed Sandbox Pool:** Maintain a managed pool of 2–3 idle sandboxed execution contexts, recycling clean instances after termination.
* **Non-blocking Execution:** Offload long-running computational tools into dedicated Web Workers managed alongside the brokered iframe sandbox.
* **Worker Health & Termination Watchdog:** Track CPU lockup or runaway loops independently from simple timeouts, offering a user-facing kill-switch for runaway executions.

---

### 2. Multi-Aspect Mesh & Agent Workflows

Aspect Studio supports summoning another persona via `@AspectName` in the chat input or `SummonAspect` in JavaScript. We can evolve this into structured multi-agent coordination:

* **Aspect Handoff & Routing:** Allow an Aspect's system instructions to delegate tasks directly to specialized sub-Aspects (e.g., a "Researcher" handing extracted data to a "Technical Writer").
* **Collaborative Group Canvas:** A split or multi-panel conversation interface where two or more Aspects interact directly with each other to solve a user's multi-step prompt, showing real-time agent-to-agent exchanges.
* **Pipeline Execution Chains:** Run serial pipelines (e.g., Prompt $\rightarrow$ Code Auditor $\rightarrow$ Test Generator) where the output of one persona serves directly as the structured context for the next.

---

### 3. Local-First Vector Retrieval (In-Browser RAG)

Currently, knowledge files (`.txt`, `.md`, `.pdf`, `.docx`) are injected as raw, truncated text into the model's context window up to `max-knowledge-chars`. When referencing extensive technical documents, this quickly consumes token budgets or overflows smaller local model context windows.

* **Client-Side Embeddings:** Ingest knowledge through small, local WebAssembly/WebGPU embedding models (e.g., `bge-micro` or `all-MiniLM-L6-v2` via Transformers.js or ONNX Runtime Web).
* **IndexedDB Vector Storage:** Store chunked text alongside vector arrays in an IndexedDB vector index.
* **Top-$K$ Hybrid Context Retrieval:** On user prompt submission, perform local cosine similarity to retrieve only relevant text chunks, prepending exact context matches rather than saturating the context window with complete documents.

---

### 4. Direct Structured Function Calling (OpenAI / Ollama Tools Schema)

Tools are currently triggered when the model emits plain-text syntactic markers: `[Run Tool: ToolName.js({"arg":"val"})]`. While universally compatible with small models, native JSON function calling yields fewer formatting errors.

* **Dynamic Schema Generation:** Parse JSDoc docstrings or JSON-schema headers from tool source files to construct OpenAI-compatible `tools` parameter objects.
* **Dual-Mode Dispatch:**
* **Native Mode:** Pass native schemas to providers that support tool calls (Groq, OpenRouter, Ollama `/api/chat`, LM Studio).
* **Text Marker Fallback:** Maintain the existing regex/bracket-based scanner for lightweight or legacy local models lacking fine-tuned tool-call heads.





---

### 5. Full-Fidelity Session Branching & Versioning

Chat sessions are currently stored as flat conversation threads.

* **Message Branching (Forking):** Allow users or automated agents to branch conversation histories from any earlier turn, creating an interactive exploration tree for code generation and creative iteration.
* **Aspect Version Control:** Enable lightweight Git-like snapshot diffs for Aspects (reverting instruction tweaks, tracking tool code revisions, and rolling back memory store entries).
