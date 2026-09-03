import { state } from "./state.js";
import { getCurrentAspect } from "./aspects.js";
import { showEditorView, markChangesUnsaved } from "./ui.js";

// CodeMirror is ~300 KB. Load it only when the tool editor is actually opened
// so it never sits in the initial bundle for users who never write a tool.
let cmModulePromise = null;
function loadCodeMirror() {
    if (!cmModulePromise) {
        cmModulePromise = Promise.all([
            import("codemirror"),
            import("@codemirror/lang-javascript")
        ]).then(([cm, langJs]) => ({
            basicSetup: cm.basicSetup,
            EditorView: cm.EditorView,
            javascript: langJs.javascript
        }));
    }
    return cmModulePromise;
}

let editorView = null;
let currentEditingToolIndex = -1;

export function initToolEditor() {
    window.openToolEditor = openToolEditor;
    window.closeToolEditor = closeToolEditor;
    window.saveToolCode = saveToolCode;
}

export async function openToolEditor(toolIndex = -1) {
    const aspect = getCurrentAspect();
    const modal = document.getElementById('tool-editor-modal');
    const nameInput = document.getElementById('tool-editor-name');
    const container = document.getElementById('codemirror-container');

    currentEditingToolIndex = toolIndex;

    let initialCode = `// New Tool
// Usage: executeTool({ arg1: "value" })
async function executeTool(args, state) {
    // state is persisted between tool calls
    return { result: "Success" };
}`;

    if (toolIndex >= 0 && aspect.tools[toolIndex]) {
        nameInput.value = aspect.tools[toolIndex].name;
        initialCode = aspect.tools[toolIndex].code;
    } else {
        nameInput.value = '';
    }

    let cm;
    try {
        cm = await loadCodeMirror();
    } catch (err) {
        console.error('Failed to load the code editor', err);
        if (typeof window.showToast === 'function') {
            window.showToast('Could not load the code editor. Check your connection and retry.', 'error');
        }
        return;
    }
    const { basicSetup, EditorView, javascript } = cm;

    // Initialize CodeMirror if not already
    if (!editorView) {
        editorView = new EditorView({
            doc: initialCode,
            extensions: [
                basicSetup,
                javascript(),
                EditorView.theme({
                    "&": {
                        color: "white",
                        backgroundColor: "#282c34"
                    },
                    ".cm-content": {
                        caretColor: "#e27c5e"
                    },
                    "&.cm-focused .cm-cursor": {
                        borderLeftColor: "#e27c5e"
                    },
                    "&.cm-focused .cm-selectionBackground, ::selection": {
                        backgroundColor: "#3e4451"
                    }
                }, {dark: true})
            ],
            parent: container
        });
    } else {
        const transaction = editorView.state.update({
            changes: { from: 0, to: editorView.state.doc.length, insert: initialCode }
        });
        editorView.dispatch(transaction);
    }

    modal.classList.remove('hidden');
}

export function closeToolEditor() {
    document.getElementById('tool-editor-modal').classList.add('hidden');
}

export function saveToolCode() {
    const aspect = getCurrentAspect();
    const name = document.getElementById('tool-editor-name').value.trim();
    const code = editorView.state.doc.toString();
    
    if (!name) {
        window.showToast("Tool name is required.", "error");
        return;
    }
    
    const finalName = name.endsWith('.js') ? name : name + '.js';

    if (currentEditingToolIndex >= 0) {
        aspect.tools[currentEditingToolIndex].name = finalName;
        aspect.tools[currentEditingToolIndex].code = code;
    } else {
        aspect.tools.push({ name: finalName, code: code, state: {} });
    }

    markChangesUnsaved();
    closeToolEditor();
    showEditorView();
}
