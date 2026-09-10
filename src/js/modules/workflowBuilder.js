import { getCurrentAspect } from './aspects.js';
import { updateAspectData, sanitizeToolName, RESERVED_TOOL_NAMES, hashToolCode } from './aspects.js';
import { markChangesUnsaved, showToast } from './ui.js';

let nodes = [];
let connections = [];
let isDragging = false;
let dragNode = null;
let dragOffset = { x: 0, y: 0 };
let isDrawingConnection = false;
let connectionStartNodeId = null;
let nodeCounter = 0;

export function resetWorkflowStateForTesting() {
    nodes = [];
    connections = [];
    isDragging = false;
    dragNode = null;
    isDrawingConnection = false;
    connectionStartNodeId = null;
    nodeCounter = 0;
}

export function openWorkflowModal() {
    document.getElementById('workflow-modal').classList.remove('hidden');
    nodes = [];
    connections = [];
    document.getElementById('workflow-nodes-container').innerHTML = '';
    document.getElementById('workflow-name-input').value = '';

    // Always start with a Start Node
    addWorkflowNode('start', 100, 100);
    renderWorkflow();
}

export function closeWorkflowModal() {
    document.getElementById('workflow-modal').classList.add('hidden');
}

export function addWorkflowNode(type, initX = 300, initY = 300) {
    const id = 'node_' + Date.now() + '_' + (++nodeCounter);
    let name = '';
    let inputs = [];
    let outputs = ['Next'];
    let configHtml = '';

    if (type === 'start') {
        name = 'Start';
        inputs = [];
        outputs = ['Next'];
    } else if (type === 'fetch') {
        name = 'Fetch Website';
        inputs = ['Trigger'];
        outputs = ['Next (Text)', 'Error'];
        configHtml = `<input type="text" id="config_${id}_url" placeholder="URL (or leave blank for input arg)" class="settings-input" style="width: 100%; margin: 5px 0; padding: 4px; font-size: 12px;">`;
    } else if (type === 'extract') {
        name = 'Extract Text (Regex)';
        inputs = ['Input Text'];
        outputs = ['Match', 'Error'];
        configHtml = `<input type="text" id="config_${id}_regex" placeholder="Regex (e.g., <title>(.*?)</title>)" class="settings-input" style="width: 100%; margin: 5px 0; padding: 4px; font-size: 12px;">`;
    } else if (type === 'memory') {
        name = 'Save to Memory';
        inputs = ['Value'];
        outputs = ['Next'];
        configHtml = `<input type="text" id="config_${id}_key" placeholder="Memory Key" class="settings-input" style="width: 100%; margin: 5px 0; padding: 4px; font-size: 12px;">`;
    } else if (type === 'custom') {
        name = 'Custom JS';
        inputs = ['Input'];
        outputs = ['Output', 'Error'];
        configHtml = `<textarea id="config_${id}_code" placeholder="return input + ' modified';" class="settings-input" style="width: 100%; height: 50px; margin: 5px 0; padding: 4px; font-size: 12px; font-family: monospace;"></textarea>`;
    }

    nodes.push({ id, type, name, x: initX, y: initY, inputs, outputs, configHtml });
    renderWorkflow();
}

function renderWorkflow() {
    const container = document.getElementById('workflow-nodes-container');
    container.innerHTML = '';

    nodes.forEach(node => {
        const el = document.createElement('div');
        el.className = 'workflow-node';
        el.id = node.id;
        el.style.position = 'absolute';
        el.style.left = node.x + 'px';
        el.style.top = node.y + 'px';
        el.style.background = 'var(--surface-color)';
        el.style.border = '1px solid var(--border-color)';
        el.style.borderRadius = '6px';
        el.style.padding = '10px';
        el.style.width = '200px';
        el.style.boxShadow = '0 4px 6px rgba(0,0,0,0.3)';
        el.style.color = '#fff';
        el.style.cursor = 'move';
        el.style.userSelect = 'none';

        let innerHTML = `<div style="font-weight: bold; border-bottom: 1px solid #444; padding-bottom: 5px; margin-bottom: 10px; display: flex; justify-content: space-between;">
                            ${node.name}
                            ${node.type !== 'start' ? `<button onclick="deleteWorkflowNode('${node.id}')" style="background: none; border: none; color: #ff5555; cursor: pointer;">X</button>` : ''}
                         </div>`;

        innerHTML += `<div style="display: flex; justify-content: space-between; font-size: 12px;">
                        <div class="inputs">
                            ${node.inputs.map((inp, idx) => `<div class="node-port input-port" data-node="${node.id}" data-idx="${idx}" style="margin-bottom: 5px; cursor: crosshair;">🔵 ${inp}</div>`).join('')}
                        </div>
                        <div class="outputs" style="text-align: right;">
                            ${node.outputs.map((out, idx) => `<div class="node-port output-port" data-node="${node.id}" data-idx="${idx}" style="margin-bottom: 5px; cursor: crosshair;">${out} 🔴</div>`).join('')}
                        </div>
                      </div>`;

        if (node.configHtml) {
            innerHTML += `<div style="margin-top: 10px;" class="no-drag">${node.configHtml}</div>`;
        }

        el.innerHTML = innerHTML;

        // Dragging logic
        el.addEventListener('mousedown', (e) => {
            if (e.target.closest('.no-drag') || e.target.tagName.toLowerCase() === 'input' || e.target.tagName.toLowerCase() === 'textarea' || e.target.classList.contains('node-port')) return;
            isDragging = true;
            dragNode = node;
            dragOffset.x = e.clientX - node.x;
            dragOffset.y = e.clientY - node.y;
        });

        container.appendChild(el);
    });

    // Event listeners for ports
    document.querySelectorAll('.output-port').forEach(port => {
        port.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            isDrawingConnection = true;
            connectionStartNodeId = port.getAttribute('data-node');
        });
    });

    document.querySelectorAll('.input-port').forEach(port => {
        port.addEventListener('mouseup', (e) => {
            if (isDrawingConnection && connectionStartNodeId) {
                const targetNodeId = port.getAttribute('data-node');
                if (connectionStartNodeId !== targetNodeId) {
                    connections.push({
                        from: connectionStartNodeId,
                        to: targetNodeId
                    });
                    renderLines();
                }
            }
            isDrawingConnection = false;
            connectionStartNodeId = null;
        });
    });

    renderLines();
}

window.deleteWorkflowNode = function(id) {
    nodes = nodes.filter(n => n.id !== id);
    connections = connections.filter(c => c.from !== id && c.to !== id);
    renderWorkflow();
};

function renderLines() {
    const svg = document.getElementById('workflow-lines');
    svg.innerHTML = '';

    connections.forEach(conn => {
        const fromNode = nodes.find(n => n.id === conn.from);
        const toNode = nodes.find(n => n.id === conn.to);
        if (!fromNode || !toNode) return;

        const fromEl = document.getElementById(fromNode.id);
        const toEl = document.getElementById(toNode.id);

        if (!fromEl || !toEl) return;

        const fromRect = fromEl.querySelector('.output-port').getBoundingClientRect();
        const toRect = toEl.querySelector('.input-port').getBoundingClientRect();
        const canvasRect = document.getElementById('workflow-canvas').getBoundingClientRect();

        const x1 = fromRect.right - canvasRect.left;
        const y1 = fromRect.top + fromRect.height/2 - canvasRect.top;
        const x2 = toRect.left - canvasRect.left;
        const y2 = toRect.top + toRect.height/2 - canvasRect.top;

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        line.setAttribute('d', `M ${x1} ${y1} C ${x1 + 50} ${y1}, ${x2 - 50} ${y2}, ${x2} ${y2}`);
        line.setAttribute('stroke', '#a38771');
        line.setAttribute('stroke-width', '2');
        line.setAttribute('fill', 'none');
        svg.appendChild(line);
    });
}

document.getElementById('workflow-canvas')?.addEventListener('mousemove', (e) => {
    if (isDragging && dragNode) {
        const canvasRect = document.getElementById('workflow-canvas').getBoundingClientRect();
        dragNode.x = e.clientX - dragOffset.x;
        dragNode.y = e.clientY - dragOffset.y;

        const el = document.getElementById(dragNode.id);
        if (el) {
            el.style.left = dragNode.x + 'px';
            el.style.top = dragNode.y + 'px';
        }
        renderLines();
    }
});

document.addEventListener('mouseup', () => {
    isDragging = false;
    dragNode = null;
    isDrawingConnection = false;
    connectionStartNodeId = null;
});

window.addWorkflowNode = addWorkflowNode;
window.openWorkflowModal = openWorkflowModal;
window.closeWorkflowModal = closeWorkflowModal;

export function compileWorkflow(nodesList, connectionsList, configGetter) {
    const getConfig = configGetter || ((nodeId, field) => {
        const el = document.getElementById(`config_${nodeId}_${field}`);
        return el ? el.value : '';
    });

    let compiledCode = `// Generated via Visual Workflow Builder\nasync function executeTool(args, state) {\n    let currentData = args;\n    let result = null;\n`;

    let currentNode = nodesList.find(n => n.type === 'start');
    if (!currentNode) {
        return { success: false, error: "Start node missing." };
    }

    let visited = new Set();
    while (currentNode) {
        if (visited.has(currentNode.id)) {
            return {
                success: false,
                error: "Cycle detected in workflow, this simple compiler only supports linear flows."
            };
        }
        visited.add(currentNode.id);

        if (currentNode.type === 'fetch') {
            const urlVal = getConfig(currentNode.id, 'url');
            compiledCode += `\n    try {\n        const url = ${JSON.stringify(urlVal)} || currentData.url || currentData;\n        const resp = await fetch(url);\n        currentData = await resp.text();\n    } catch (e) {\n        return { error: 'Fetch failed: ' + e.message };\n    }\n`;
        } else if (currentNode.type === 'extract') {
            const regexVal = getConfig(currentNode.id, 'regex');
            try {
                new RegExp(regexVal);
            } catch (err) {
                return {
                    success: false,
                    error: `Invalid regular expression in Extract node: ${err.message}`
                };
            }
            compiledCode += `\n    try {\n        const rgx = new RegExp(${JSON.stringify(regexVal)});\n        const m = currentData.match(rgx);\n        currentData = m ? m[1] || m[0] : null;\n    } catch (e) {\n        return { error: 'Extraction failed: ' + e.message };\n    }\n`;
        } else if (currentNode.type === 'memory') {
            const keyVal = getConfig(currentNode.id, 'key');
            compiledCode += `\n    try {\n        const key = ${JSON.stringify(keyVal)};\n        await new Promise((resolve) => {\n            const messageId = Date.now().toString() + Math.random();\n            const listener = (e) => {\n                if (e.data.type === 'memoryWriteComplete' && e.data.messageId === messageId) {\n                    self.removeEventListener('message', listener);\n                    resolve();\n                }\n            };\n            self.addEventListener('message', listener);\n            self.postMessage({ type: 'writeMemory', key: key, value: currentData, messageId: messageId });\n        });\n    } catch (e) {\n        return { error: 'Memory save failed: ' + e.message };\n    }\n`;
        } else if (currentNode.type === 'custom') {
            const codeVal = getConfig(currentNode.id, 'code');
            compiledCode += `\n    try {\n        const customFn = async (input) => {\n            ${codeVal}\n        };\n        currentData = await customFn(currentData);\n    } catch (e) {\n        return { error: 'Custom JS failed: ' + e.message };\n    }\n`;
        }

        const nextConn = connectionsList.find(c => c.from === currentNode.id);
        if (nextConn) {
            currentNode = nodesList.find(n => n.id === nextConn.to);
        } else {
            currentNode = null;
        }
    }

    compiledCode += `\n    return { success: true, finalData: currentData };\n}`;
    return { success: true, code: compiledCode };
}

export function saveWorkflowAsTool() {
    const nameInput = document.getElementById('workflow-name-input')?.value?.trim() || '';
    if (!nameInput) {
        showToast("Please enter a tool name.", "error");
        return;
    }

    let toolName = sanitizeToolName(nameInput);
    if (!toolName.endsWith('.js')) toolName += '.js';

    const isReserved = RESERVED_TOOL_NAMES.some(r => r.toLowerCase() === toolName.toLowerCase());
    if (isReserved) {
        showToast(`"${toolName}" is reserved for system tools. Please use a different name.`, "error");
        return;
    }

    const compileResult = compileWorkflow(nodes, connections);
    if (!compileResult.success) {
        showToast(compileResult.error, "error");
        return;
    }

    const aspect = getCurrentAspect();
    if (!aspect) {
        showToast("No active Aspect selected.", "error");
        return;
    }

    if (!Array.isArray(aspect.tools)) {
        aspect.tools = [];
    }

    const existingIdx = aspect.tools.findIndex(t => t.name === toolName);
    if (existingIdx !== -1) {
        aspect.tools[existingIdx].code = compileResult.code;
        // Re-stamp trustedHash so a regenerated workflow tool is immediately
        // runnable — the user authored it locally, so it is implicitly reviewed.
        aspect.tools[existingIdx].trustedHash = hashToolCode(compileResult.code);
    } else {
        // Stamp trustedHash at creation: the code was generated from the user's
        // own canvas configuration on this machine, satisfying the review gate
        // (F-07). Without this the tool stays silently inert until the user
        // opens it in the editor and clicks Enable.
        aspect.tools.push({
            name: toolName,
            code: compileResult.code,
            state: {},
            trustedHash: hashToolCode(compileResult.code)
        });
    }

    markChangesUnsaved();
    showToast(`Saved "${toolName}". It is ready to run.`);
    closeWorkflowModal();
}
window.saveWorkflowAsTool = saveWorkflowAsTool;
