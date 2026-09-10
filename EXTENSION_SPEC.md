# EXTENSION_SPEC.md: Developer Ecosystem & Extensibility

This document outlines enhancements to make custom tool building, workflow authoring, and external orchestration more powerful.

---

### 1. Expanded System Tool Suite

Provide ready-made, hardened built-in system tools targeting common developer workflows:

| Tool Name | Operation Mode | Description |
| --- | --- | --- |
| **`GitInspector.js`** | Brokered Local HTTP | Interrogates local repository status and diffs via a lightweight local endpoint or bridge. |
| **`RegexTester.js`** | Pure In-Sandbox JS | Evaluates and benchmarks regular expressions against sample corpora without network access. |
| **`ASTParser.js`** | Pure In-Sandbox JS | Parses incoming JavaScript/JSON strings into AST objects to allow programmatic code analysis within the sandbox. |
| **`CanvasRenderer.js`** | Brokered DOM Call | Allows tools to emit dynamic SVG or Canvas charts back to the UI chat bubble. |

---

### 2. Enhanced Memory Engine

Memory currently operates as a basic key-value store per Aspect.

* **Namespaced Memory:** Support hierarchical namespaces (e.g., `memory.get("projects/aspect-chat/todos")`).
* **Temporal / Ephemeral Memory:** Provide flags for session-only keys versus persistent, cross-conversation keys.
* **Memory Event Listeners:** Allow tools to observe when a key is updated, triggering automated workflow actions or logging memory state transitions to the chat transcript.

---

### 3. Visual Workflow Builder Enhancements

The visual workflow builder (`workflowBuilder.js`) currently provides basic sequential node chains.

* **Conditional Branching:** Add decision/routing nodes (e.g., `If contains`, `If regex match`) allowing workflows to diverge based on prior node output.
* **Parallel Node Execution:** Support branching into parallel async tasks (e.g., fetching multiple websites simultaneously) followed by a join/aggregate node.
* **Live Node Debugger:** Enable step-by-step test execution on the workflow canvas with live variable inspector cards before saving as a runnable tool.
