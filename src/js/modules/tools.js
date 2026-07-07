import { renderChatMessages } from './chat.js';
import { getKnowledgeFilesText } from './db.js';
import { init } from './init.js';
import { markChangesUnsaved } from './ui.js';
import { getCurrentAspect } from './aspects.js';
import { state } from './state.js';


        export async function executeJavaScriptTool(toolName, argStr) {
            const aspect = getCurrentAspect();
            const tool = aspect.tools.find(t => t.name === toolName);
            if (!tool) {
                return JSON.stringify({ error: `Tool "${toolName}" not found.` });
            }
            try {
                let parsedArgs = {};
                if (argStr && argStr.trim()) {
                    try {
                        parsedArgs = JSON.parse(argStr.trim());
                    } catch {
                        parsedArgs = argStr.trim();
                    }
                }
                
                // Construct safe asynchronous wrapper using Web Worker to sandbox execution
                const workerCode = `
                    self.onmessage = async function(e) {
                        const { args } = e.data;
                        try {
                            ${tool.code}
                            if (typeof executeTool === 'function') {
                                const result = await executeTool(args);
                                self.postMessage({ success: true, result });
                            } else {
                                self.postMessage({ success: false, error: "Function executeTool(args) is not defined in this script. Ensure you have 'function executeTool(args) { ... }' in your tool." });
                            }
                        } catch (err) {
                            self.postMessage({ success: false, error: err.message });
                        }
                    };
                `;
                const blob = new Blob([workerCode], { type: 'application/javascript' });
                const workerUrl = URL.createObjectURL(blob);
                const worker = new Worker(workerUrl);
                
                const result = await new Promise((resolve, reject) => {
                    worker.onmessage = (e) => {
                        if (e.data.success) resolve(e.data.result);
                        else reject(new Error(e.data.error));
                        worker.terminate();
                        URL.revokeObjectURL(workerUrl);
                    };
                    worker.onerror = (err) => {
                        reject(err);
                        worker.terminate();
                        URL.revokeObjectURL(workerUrl);
                    };
                    worker.postMessage({ args: parsedArgs });
                });
                return typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
            } catch (err) {
                return JSON.stringify({ error: `Runtime error in ${toolName}: ${err.message}` });
            }
        }

        export function insertToolTag(toolName) {
            const input = document.getElementById('chat-input');
            input.value += ` [Run Tool: ${toolName}]`;
            input.focus();
            document.getElementById('tools-dropdown').classList.remove('show');
        }

        export function addSystemLog(content) {
            const aspect = getCurrentAspect();
            const logId = Date.now().toString() + Math.random().toString();
            aspect.chatHistory.push({ id: logId, role: 'system', content: content });
            renderChatMessages();
            return logId;
        }

        export function updateSystemLog(logId, content) {
            const aspect = getCurrentAspect();
            const msg = aspect.chatHistory.find(m => m.id === logId);
            if (msg) {
                msg.content = content;
                renderChatMessages();
                markChangesUnsaved();
            }
        }

        export async function processAIResponseAndTools(aiMessage, aspect) {
            if (aiMessage === null || aiMessage === undefined) {
                aiMessage = "";
            }
            const toolCallRegex = /\[Run Tool:\s*([a-zA-Z0-9_\-\.]+)(?:\((.*?)\))?\s*\]/g;
            let match;
            const toolCalls = [];
            
            while ((match = toolCallRegex.exec(aiMessage)) !== null) {
                toolCalls.push({
                    fullMatch: match[0],
                    name: match[1],
                    args: match[2] || ""
                });
            }

            if (toolCalls.length === 0) {
                aspect.chatHistory.push({ role: 'assistant', content: aiMessage });
                renderChatMessages();
                markChangesUnsaved();
                return;
            }

            aspect.chatHistory.push({ role: 'assistant', content: aiMessage });
            renderChatMessages();
            markChangesUnsaved();

            let toolResultsText = "";
            for (let tc of toolCalls) {
                const logId = addSystemLog(`Executing tool \`${tc.name}\`...`);
                const result = await executeJavaScriptTool(tc.name, tc.args);
                updateSystemLog(logId, `🛠️ **Tool Executed:** \`${tc.name}\`\n\n**Result:**\n\`\`\`json\n${result}\n\`\`\``);
                toolResultsText += `Tool ${tc.name} returned:\n${result}\n\n`;
            }

            if (!state.consecutiveToolRuns) state.consecutiveToolRuns = 0;
            state.consecutiveToolRuns++;
            
            if (state.consecutiveToolRuns > 5) {
                addSystemLog("⚠️ Loop protection triggered: Maximum of 5 consecutive tool runs reached.");
                state.consecutiveToolRuns = 0;
                return;
            }

            await sendAIRequest(toolResultsText);
        }

        export async function sendAIRequest(extraContext) {
            const aspect = getCurrentAspect();
            if (!aspect) return;

            document.getElementById('send-btn').disabled = true;
            document.getElementById('chat-input').disabled = true;

            const writingId = addSystemLog(`*${aspect.name} is reflecting...*`);

            try {
                if (!state.settings.apiUrl || !state.settings.apiKey) {
                    throw new Error("API credentials not configured. Please click the Gear icon in the sidebar to configure them.");
                }

                const extraFileText = await getKnowledgeFilesText(aspect.id);
                let systemPrompt = `${aspect.instructions}\n\n# Knowledge Bank\n${aspect.knowledge || 'None.'}${extraFileText}`;
                
                const apiMessages = [
                    { role: 'system', content: systemPrompt }
                ];

                aspect.chatHistory.forEach(msg => {
                    if (msg.role === 'user' || msg.role === 'assistant') {
                        apiMessages.push({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.content });
                    }
                });

                if (extraContext) {
                    apiMessages.push({ role: 'system', content: `[System Notification: The following are results from executed JavaScript tools. Integrate these facts into your final dialogue with the user. Do not call the same tool with identical arguments again.]\n\n${extraContext}` });
                }

                let endpoint = state.settings.apiUrl.trim();
                if (!endpoint.endsWith('/chat/completions') && !endpoint.endsWith('/chat/completions/')) {
                    endpoint = endpoint.replace(/\/+$/, '') + '/chat/completions';
                }
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${state.settings.apiKey}`
                    },
                    body: JSON.stringify({
                        model: state.settings.model,
                        messages: apiMessages,
                        temperature: 0.7
                    })
                });

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    const errMsg = errData.error?.message || response.statusText;
                    throw new Error(`API error ${response.status}: ${errMsg}`);
                }
                
                const data = await response.json();
                const aiMessage = data.choices?.[0]?.message?.content ?? "";

                const idx = aspect.chatHistory.findIndex(m => m.id === writingId);
                if (idx !== -1) {
                    aspect.chatHistory.splice(idx, 1);
                }

                await processAIResponseAndTools(aiMessage, aspect);

            } catch (error) {
                const idx = aspect.chatHistory.findIndex(m => m.id === writingId);
                if (idx !== -1) {
                    aspect.chatHistory.splice(idx, 1);
                }
                addSystemLog(`❌ **Error:** ${error.message}`);
            } finally {
                document.getElementById('send-btn').disabled = false;
                document.getElementById('chat-input').disabled = false;
                document.getElementById('chat-input').focus();
                renderChatMessages();
            }
        }

        export async function sendMessage() {
            const input = document.getElementById('chat-input');
            const text = input.value.trim();
            if (!text) return;

            const aspect = getCurrentAspect();
            if (!aspect) return;
            
            aspect.chatHistory.push({ role: 'user', content: text });
            input.value = '';
            input.style.height = 'auto'; // Reset textarea height
            renderChatMessages();
            markChangesUnsaved();

            state.consecutiveToolRuns = 0;

            const toolCallRegex = /\[Run Tool:\s*([a-zA-Z0-9_\-\.]+)(?:\((.*?)\))?\s*\]/g;
            let match;
            let userToolResults = "";
            const userToolCalls = [];
            
            while ((match = toolCallRegex.exec(text)) !== null) {
                userToolCalls.push({
                    fullMatch: match[0],
                    name: match[1],
                    args: match[2] || ""
                });
            }

            if (userToolCalls.length > 0) {
                for (let tc of userToolCalls) {
                    const logId = addSystemLog(`Executing user-triggered tool \`${tc.name}\`...`);
                    const result = await executeJavaScriptTool(tc.name, tc.args);
                    updateSystemLog(logId, `🛠️ **User-Triggered Tool:** \`${tc.name}\`\n\n**Result:**\n\`\`\`json\n${result}\n\`\`\``);
                    userToolResults += `User executed tool ${tc.name} which returned:\n${result}\n\n`;
                }
            }

            await sendAIRequest(userToolResults);
        }

        // Close dropdown if clicking outside
        window.onclick = function(event) {
            if (!event.target.matches('#tools-btn')) {
                document.getElementById('tools-dropdown').classList.remove('show');
            }
        }

        // Start app is now handled in main.js
