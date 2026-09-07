import { showChatView } from './ui.js';
import { renderAspectList } from './aspects.js';
import { getCurrentAspect } from './aspects.js';
import { markChangesSaved } from './state.js';
import { state } from './state.js';
import { getKnowledgeFilesRaw, saveKnowledgeFile } from './db.js';
import { normalizeAspect, sanitizeToolName, RESERVED_TOOL_NAMES } from './aspects.js';
import { newId } from './conversations.js';

/**
 * Make imported tool filenames safe and non-deceptive: sanitised charset, no
 * collision with a built-in system tool (an unreviewed `Calculator.js` must not
 * masquerade as the trusted one), and no duplicates within the Aspect.
 */
export function resolveImportedToolNames(tools) {
    const reserved = new Set(RESERVED_TOOL_NAMES.map(n => n.toLowerCase()));
    const seen = new Set();
    tools.forEach(t => {
        let base = sanitizeToolName(t.name);
        if (reserved.has(base.toLowerCase())) base = 'imported_' + base;
        let name = base;
        let i = 2;
        while (seen.has(name.toLowerCase())) {
            name = base.replace(/\.js$/i, '') + '_' + (i++) + '.js';
        }
        seen.add(name.toLowerCase());
        t.name = name;
    });
    return tools;
}

// JSZip (~95 KB) is only needed for .aspect import/export. Load it on demand.
let jszipPromise = null;
function loadJSZip() {
    if (!jszipPromise) {
        jszipPromise = import('jszip').then(m => m.default || m);
    }
    return jszipPromise;
}

        export async function saveAspectToFile() {
            const aspect = getCurrentAspect();
            if (!aspect) return;

            const JSZip = await loadJSZip();
            const zip = new JSZip();
            
            zip.file("Name.md", aspect.name);
            zip.file("Description.md", aspect.description);
            zip.file("Instructions.md", aspect.instructions);
            zip.file("Knowledge/KnowledgeFile.md", aspect.knowledge || "");
            
            if (aspect.icon) {
                const matches = aspect.icon.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
                if (matches) {
                    const base64Data = matches[2];
                    zip.file("Icon.png", base64Data, {base64: true});
                } else {
                    zip.file("Icon.png", aspect.icon);
                }
            }

            if (aspect.background) {
                if (aspect.background.startsWith('data:')) {
                    const matches = aspect.background.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
                    if (matches) {
                        const base64Data = matches[2];
                        zip.file("Background.jpeg", base64Data, {base64: true});
                    }
                } else {
                    try {
                        const response = await fetch(`./${aspect.background}`).catch(() => null);
                        if (response && response.ok) {
                            const blob = await response.blob();
                            zip.file("Background.jpeg", blob);
                        }
                    } catch (err) {
                        console.error("Failed to fetch preset background for zip packing", err);
                    }
                }
            }

            const toolsFolder = zip.folder("Tools");
            if (aspect.tools) {
                const toolsState = {};
                aspect.tools.forEach(tool => {
                    toolsFolder.file(tool.name, tool.code);
                    if (tool.state) toolsState[tool.name] = tool.state;
                });
                if (Object.keys(toolsState).length > 0) {
                    toolsFolder.file("state.json", JSON.stringify(toolsState, null, 2));
                }
            }

            // Chat history is written twice, on purpose:
            //
            //  - conversations.json is the lossless record. It round-trips every
            //    conversation with its title, timestamps and exact message text.
            //  - ChatHistory/History.md is the human-readable transcript of the
            //    active conversation, and is what older builds of Aspect Studio
            //    (and the documented .aspect layout) know how to read.
            //
            // Import prefers the JSON and falls back to the Markdown, so files
            // move in both directions without losing anything.
            const conversations = (aspect.conversations || []).map(conv => ({
                id: conv.id,
                title: conv.title,
                titleLocked: !!conv.titleLocked,
                createdAt: conv.createdAt,
                updatedAt: conv.updatedAt,
                messages: (conv.messages || [])
                    .filter(m => m.role === 'user' || m.role === 'assistant')
                    .map(m => ({ role: m.role, content: m.content }))
            }));
            zip.file("ChatHistory/conversations.json", JSON.stringify({
                version: 2,
                activeConversationId: aspect.activeConversationId,
                conversations
            }, null, 2));

            let historyMd = "";
            aspect.chatHistory.forEach(msg => {
                if (msg.role === 'user' || msg.role === 'assistant') {
                    historyMd += `### ${msg.role === 'user' ? 'User' : aspect.name}\n${msg.content}\n\n`;
                }
            });
            zip.file("ChatHistory/History.md", historyMd);

            // Generation settings and editor mode travel with the Aspect so an
            // imported one behaves exactly as it did for its author.
            zip.file("config.json", JSON.stringify({
                params: aspect.params || {},
                basicMode: aspect.basicMode,
                basicDescription: aspect.basicDescription,
                basicTone: aspect.basicTone
            }, null, 2));

            // Export raw knowledge files from IndexedDB
            const rawKnowledgeFiles = await getKnowledgeFilesRaw(aspect.id);
            zip.file("memory.json", JSON.stringify(aspect.memory || {}, null, 2));

            if (rawKnowledgeFiles && rawKnowledgeFiles.length > 0) {
                const knowledgeFolder = zip.folder("Knowledge/Files");
                rawKnowledgeFiles.forEach(f => {
                    knowledgeFolder.file(f.name, f.text);
                });
            }

            const blob = await zip.generateAsync({type: "blob"});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${aspect.name.replace(/[^a-zA-Z0-9]/g, '_')}.aspect`;
            a.click();
            URL.revokeObjectURL(url);
            
            markChangesSaved();
        }

        export async function loadAspectFile(event) {
            const file = event.target.files[0];
            if (!file) return;

            try {
                const JSZip = await loadJSZip();
                const zip = await JSZip.loadAsync(file);
                
                const nameFile = zip.file("Name.md");
                const descFile = zip.file("Description.md");
                const instrFile = zip.file("Instructions.md");
                
                // Removed strict validation to allow graceful degradation when files are missing or malformed

                const name = nameFile ? (await nameFile.async("string")).trim() : "Imported Aspect";
                const desc = descFile ? (await descFile.async("string")).trim() : "";
                const instr = instrFile ? (await instrFile.async("string")).trim() : "";
                
                const knowledgeFile = zip.file("Knowledge/KnowledgeFile.md");
                const knowledge = knowledgeFile ? await knowledgeFile.async("string") : "";
                
                let icon = "";
                if (zip.file("Icon.png")) {
                    const imgData = await zip.file("Icon.png").async("base64");
                    icon = `data:image/png;base64,${imgData}`;
                } else if (zip.file("Icon.b64")) {
                    const b64 = await zip.file("Icon.b64").async("string");
                    icon = `data:image/png;base64,${b64}`;
                }

                let background = "";
                if (zip.file("Background.jpeg")) {
                    const imgData = await zip.file("Background.jpeg").async("base64");
                    background = `data:image/jpeg;base64,${imgData}`;
                }

                const tools = [];
                const toolsFolder = zip.folder("Tools");
                if (toolsFolder) {
                    const promises = [];
                    let toolsState = {};
                    
                    if (toolsFolder.file("state.json")) {
                        const stateJsonStr = await toolsFolder.file("state.json").async("string");
                        try {
                            toolsState = JSON.parse(stateJsonStr);
                        } catch (e) {
                            console.error("Failed to parse tool state.json during aspect import", e.message);
                        }
                    }

                    Object.keys(toolsFolder.files).forEach(path => {
                        if (path.endsWith(".js") && !toolsFolder.files[path].dir) {
                            const p = toolsFolder.files[path].async("string").then(code => {
                                const toolName = path.split('/').pop();
                                tools.push({
                                    // name is re-resolved after all tools load
                                    // (see resolveImportedToolNames)
                                    name: toolName,
                                    code,
                                    state: toolsState[toolName] || {}
                                });
                            });
                            promises.push(p);
                        }
                    });
                    await Promise.all(promises);
                    resolveImportedToolNames(tools);
                }

                let memory = {};
                if (zip.file("memory.json")) {
                    const memoryStr = await zip.file("memory.json").async("string");
                    try {
                        memory = JSON.parse(memoryStr);
                    } catch (e) {
                        console.error("Failed to parse memory.json during aspect import", e.message);
                    }
                }

                // Prefer the lossless conversation record; fall back to the
                // Markdown transcript for files written before it existed.
                let conversations = null;
                let activeConversationId = null;
                const conversationsEntry = zip.file("ChatHistory/conversations.json");
                if (conversationsEntry) {
                    try {
                        const parsed = JSON.parse(await conversationsEntry.async("string"));
                        if (Array.isArray(parsed?.conversations) && parsed.conversations.length > 0) {
                            conversations = parsed.conversations.map(conv => ({
                                // Re-key on import so importing the same file
                                // twice cannot collide with the existing copy.
                                id: newId('conv'),
                                originalId: conv.id,
                                title: conv.title || 'Imported chat',
                                titleLocked: !!conv.titleLocked,
                                createdAt: conv.createdAt || Date.now(),
                                updatedAt: conv.updatedAt || conv.createdAt || Date.now(),
                                messages: Array.isArray(conv.messages)
                                    ? conv.messages
                                        .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
                                        .map(m => ({ role: m.role, content: m.content }))
                                    : []
                            }));
                            const match = conversations.find(c => c.originalId === parsed.activeConversationId);
                            activeConversationId = (match || conversations[0]).id;
                            conversations.forEach(c => { delete c.originalId; });
                        }
                    } catch (e) {
                        console.error("Failed to parse conversations.json during aspect import", e.message);
                    }
                }

                const chatHistory = [];
                if (!conversations && zip.file("ChatHistory/History.md")) {
                    const histMd = await zip.file("ChatHistory/History.md").async("string");
                    const blocks = histMd.split('### ').slice(1);
                    blocks.forEach(block => {
                        const lines = block.split('\n');
                        const header = lines[0].trim();
                        const role = header === 'User' ? 'user' : 'assistant';
                        const content = lines.slice(1).join('\n').trim();
                        if (content) {
                            chatHistory.push({ role, content });
                        }
                    });
                }

                let config = {};
                if (zip.file("config.json")) {
                    try {
                        config = JSON.parse(await zip.file("config.json").async("string")) || {};
                    } catch (e) {
                        console.error("Failed to parse config.json during aspect import", e.message);
                    }
                }

                const newAspect = normalizeAspect({
                    id: newId('aspect'),
                    name,
                    description: desc,
                    instructions: instr,
                    knowledge,
                    icon,
                    background,
                    tools,
                    // Imported tool code is arbitrary JavaScript the user has
                    // not seen. It stays inert until reviewed in the editor.
                    toolsReviewed: tools.length === 0,
                    memory,
                    params: config.params || {},
                    basicMode: config.basicMode,
                    basicDescription: config.basicDescription,
                    basicTone: config.basicTone,
                    ...(conversations
                        ? { conversations, activeConversationId }
                        : { chatHistory })
                });

                state.aspects.push(newAspect);
                state.currentAspectId = newAspect.id;
                
                // Import raw knowledge files to IndexedDB
                const knowledgeFilesFolder = zip.folder("Knowledge/Files");
                if (knowledgeFilesFolder) {
                    const promises = [];
                    for (let relativePath in knowledgeFilesFolder.files) {
                        const zipEntry = knowledgeFilesFolder.files[relativePath];
                        if (!zipEntry.dir) {
                            promises.push(
                                zipEntry.async('string').then(fileText => {
                                    // Extract just the filename from relative path (if nested, we flatten for IndexedDB)
                                    const fileName = relativePath.split('/').pop() || relativePath;
                                    return saveKnowledgeFile(newAspect.id, fileName, fileText);
                                })
                            );
                        }
                    }
                    await Promise.all(promises);
                }

                renderAspectList();
                showChatView();
                markChangesSaved();

                if (newAspect.toolsReviewed === false) {
                    window.showToast(
                        `Imported "${name}" with ${tools.length} tool(s) left DISABLED. ` +
                        `Open the editor, review the tool code, then enable them.`,
                        'error'
                    );
                }

            } catch (err) {
                console.error("Error loading .aspect file", err);
                window.showToast(`Error loading .aspect file: ${err.message}`, "error");
            } finally {
                event.target.value = '';
            }
        }

        // Full HTML-entity escape, safe for both text and double-quoted
        // attribute contexts.
        function esc(value) {
            return String(value == null ? '' : value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        // Only allow an icon the exported page can safely render as an image.
        function safeIconSrc(icon) {
            if (typeof icon !== 'string') return '';
            return /^data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=\s]+$/i.test(icon) ? icon : '';
        }

        export async function exportAspectToWebpage() {
            const aspect = getCurrentAspect();
            if (!aspect) return;

            const safeName = esc(aspect.name);
            const safeDesc = esc(aspect.description);
            const safeInstructions = esc(aspect.instructions);
            const safeIcon = esc(safeIconSrc(aspect.icon));

            const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
    <title>${safeName} - Aspect Card</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: #f5ece1;
            color: #3d2f26;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            padding: 20px;
        }
        .card {
            background: #fff;
            border-radius: 16px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            max-width: 600px;
            width: 100%;
            padding: 40px;
            text-align: center;
        }
        .icon {
            width: 120px;
            height: 120px;
            border-radius: 50%;
            object-fit: cover;
            border: 4px solid #597d53;
            margin-bottom: 20px;
        }
        h1 { margin: 0 0 10px 0; color: #cc6d4e; }
        p.desc { font-size: 1.2rem; color: #7c685b; margin-bottom: 30px; }
        .details { text-align: left; background: #f9f9f9; padding: 20px; border-radius: 8px; font-size: 0.95rem; line-height: 1.5; white-space: pre-wrap; }
        .badge { display: inline-block; background: #597d53; color: white; padding: 5px 12px; border-radius: 20px; font-size: 0.8rem; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="card">
        <img class="icon" src="${safeIcon}" alt="Aspect Icon">
        <h1>${safeName}</h1>
        <p class="desc">${safeDesc}</p>
        <div class="details">
            <strong>System Prompt / Instructions:</strong><br><br>
            ${safeInstructions}
        </div>
        <div class="badge">Created with Aspect Studio</div>
    </div>
</body>
</html>`;

            const blob = new Blob([htmlContent], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${aspect.name.replace(/[^a-zA-Z0-9]/g, '_')}_card.html`;
            a.click();
            URL.revokeObjectURL(url);
            
            window.showToast("Webpage Exported Successfully!", "success");
        }
