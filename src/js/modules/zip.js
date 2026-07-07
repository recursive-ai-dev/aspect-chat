import { showChatView } from './ui.js';
import { renderAspectList } from './aspects.js';
import JSZip from 'jszip';
import { getCurrentAspect } from './aspects.js';
import { markChangesSaved } from './state.js';
import { state } from './state.js';
import { getKnowledgeFilesRaw, saveKnowledgeFile } from './db.js';


        export async function saveAspectToFile() {
            const aspect = getCurrentAspect();
            if (!aspect) return;

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
                        const response = await fetch(`./${aspect.background}`);
                        if (response.ok) {
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

            // Save history in standard format
            let historyMd = "";
            aspect.chatHistory.forEach(msg => {
                if (msg.role === 'user' || msg.role === 'assistant') {
                    historyMd += `### ${msg.role === 'user' ? 'User' : aspect.name}\n${msg.content}\n\n`;
                }
            });
            zip.file("ChatHistory/History.md", historyMd);

            // Export raw knowledge files from IndexedDB
            const rawKnowledgeFiles = await getKnowledgeFilesRaw(aspect.id);
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
                const zip = await JSZip.loadAsync(file);
                
                const nameFile = zip.file("Name.md");
                const descFile = zip.file("Description.md");
                const instrFile = zip.file("Instructions.md");
                
                if (!nameFile || !descFile || !instrFile) {
                    throw new Error("Invalid .aspect file: missing essential metadata files (Name.md, Description.md, or Instructions.md).");
                }

                const name = (await nameFile.async("string")).trim();
                const desc = (await descFile.async("string")).trim();
                const instr = (await instrFile.async("string")).trim();
                
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
                            console.error("Failed to parse tool state.json");
                        }
                    }

                    Object.keys(toolsFolder.files).forEach(path => {
                        if (path.endsWith(".js") && !toolsFolder.files[path].dir) {
                            const p = toolsFolder.files[path].async("string").then(code => {
                                const toolName = path.split('/').pop();
                                tools.push({ 
                                    name: toolName, 
                                    code,
                                    state: toolsState[toolName] || {}
                                });
                            });
                            promises.push(p);
                        }
                    });
                    await Promise.all(promises);
                }

                const chatHistory = [];
                if (zip.file("ChatHistory/History.md")) {
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

                const newAspect = {
                    id: Date.now().toString(),
                    name,
                    description: desc,
                    instructions: instr,
                    knowledge,
                    icon,
                    background,
                    tools,
                    chatHistory
                };

                state.aspects.push(newAspect);
                state.currentAspectId = newAspect.id;
                
                // Import raw knowledge files to IndexedDB
                const knowledgeFilesFolder = zip.folder("Knowledge/Files");
                if (knowledgeFilesFolder) {
                    for (let relativePath in knowledgeFilesFolder.files) {
                        const zipEntry = knowledgeFilesFolder.files[relativePath];
                        if (!zipEntry.dir) {
                            const fileText = await zipEntry.async('string');
                            // Extract just the filename from relative path (if nested, we flatten for IndexedDB)
                            const fileName = relativePath.split('/').pop() || relativePath;
                            await saveKnowledgeFile(newAspect.id, fileName, fileText);
                        }
                    }
                }

                renderAspectList();
                showChatView();
                markChangesSaved();

            } catch (err) {
                console.error("Error loading .aspect file", err);
                window.showToast(`Error loading .aspect file: ${err.message}`, "error");
            } finally {
                event.target.value = '';
            }
        }

        export async function exportAspectToWebpage() {
            const aspect = getCurrentAspect();
            if (!aspect) return;

            const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${aspect.name} - Aspect Card</title>
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
        <img class="icon" src="${aspect.icon || ''}" alt="Aspect Icon">
        <h1>${aspect.name}</h1>
        <p class="desc">${aspect.description}</p>
        <div class="details">
            <strong>System Prompt / Instructions:</strong><br><br>
            ${aspect.instructions.replace(/</g, "&lt;").replace(/>/g, "&gt;")}
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
