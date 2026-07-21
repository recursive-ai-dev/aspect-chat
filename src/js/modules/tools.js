import { renderChatMessages, createStreamingBubble, updateStreamingBubble } from './chat.js';
import { getKnowledgeFilesText, saveMemory } from './db.js';
import { markChangesUnsaved, setChatLoadingState } from './ui.js';
import { initWebLLMEngine } from './webllm.js';
import { getCurrentAspect } from './aspects.js';
import { state } from './state.js';
export function getApiEndpoint(apiUrl) {
    let endpoint = apiUrl.trim();
    if (!endpoint.endsWith('/chat/completions') && !endpoint.endsWith('/chat/completions/')) {
        endpoint = endpoint.replace(/\/+$/, '') + '/chat/completions';
    }
    return endpoint;
}

export function buildSystemPrompt(aspect, extraFileText) {
    return `${aspect.instructions}

# Knowledge Bank
${aspect.knowledge || 'None.'}${extraFileText}`;
}

export function buildApiMessages(aspect, systemPrompt, extraContext, maxContext) {
    const apiMessages = [
        { role: 'system', content: systemPrompt }
    ];

    const contextMessages = aspect.chatHistory.filter(msg => msg.role === 'user' || msg.role === 'assistant');
    const slicedMessages = contextMessages.slice(-maxContext);

    slicedMessages.forEach(msg => {
        apiMessages.push({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.content });
    });

    if (extraContext) {
        apiMessages.push({ role: 'system', content: `[System Notification: The following are results from executed JavaScript tools. Integrate these facts into your final dialogue with the user. Do not call the same tool with identical arguments again.]

${extraContext}` });
    }
    return apiMessages;
}

export async function handleStreamResponse(reader, createStreamingBubble, updateStreamingBubble) {
    const decoder = new TextDecoder('utf-8');
    let aiMessage = "";
    let isFirstChunk = true;
    let bubbleElement = null;
    let pendingData = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            if (bubbleElement) updateStreamingBubble(bubbleElement, aiMessage);
            break;
        }

        const chunk = decoder.decode(value, { stream: true });
        pendingData += chunk;
        const lines = pendingData.split('\n');
        pendingData = lines.pop();

        for (let line of lines) {
            const cleanLine = line.replace(/\r$/, '').trim();
            if (cleanLine === '') continue;
            if (cleanLine.startsWith('data:')) {
                const dataStr = cleanLine.slice(5).trim();
                if (dataStr === '[DONE]') continue;
                try {
                    const data = JSON.parse(dataStr);
                    if (data.choices && data.choices[0].delta && data.choices[0].delta.content) {
                        aiMessage += data.choices[0].delta.content;

                        if (isFirstChunk) {
                            bubbleElement = createStreamingBubble();
                            isFirstChunk = false;
                        }
                        updateStreamingBubble(bubbleElement, aiMessage);
                    }
                } catch (e) {
                    // Ignore partial JSON
                }
            }
        }
    }

    // Flush any final SSE line that was not terminated by a newline
    const finalLine = pendingData.replace(/\r$/, '').trim();
    if (finalLine !== '') {
        if (finalLine.startsWith('data:')) {
            const dataStr = finalLine.slice(5).trim();
            if (dataStr !== '[DONE]') {
                try {
                    const data = JSON.parse(dataStr);
                    if (data.choices && data.choices[0].delta && data.choices[0].delta.content) {
                        aiMessage += data.choices[0].delta.content;
                        if (bubbleElement) updateStreamingBubble(bubbleElement, aiMessage);
                    }
                } catch (e) {
                    // Ignore partial JSON
                }
            }
        }
    }
    return aiMessage;
}





        export async function fetchAIResponseForAspect(aspect, prompt) {
            if (!state.settings.apiUrl || !state.settings.apiKey) {
                throw new Error("API credentials not configured.");
            }

            const extraFileText = await getKnowledgeFilesText(aspect.id);
            const systemPrompt = buildSystemPrompt(aspect, extraFileText);

            const apiMessages = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: prompt }
            ];

            const endpoint = getApiEndpoint(state.settings.apiUrl);

            let response;
            try {
                response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${state.settings.apiKey}`
                    },
                    body: JSON.stringify({
                        model: state.settings.model,
                        messages: apiMessages,
                        temperature: 0.7,
                        stream: false // Non-streaming for summons
                    })
                });
            } catch (err) {
                throw new Error(`Network error: ${err.message}`);
            }

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                const errMsg = errData.error?.message || response.statusText;
                throw new Error(`API error ${response.status}: ${errMsg}`);
            }

            const data = await response.json().catch(() => ({}));
            const content = data?.choices?.[0]?.message?.content;
            if (content == null) {
                throw new Error("Empty response from model.");
            }
            return content;
        }

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
                const workerCode = [
                    "self.onmessage = async function(e) {",
                    "    if (!e || !e.data) return;",
                    "    if (e.data.type === 'memoryWriteComplete') return; // Handled by tool listener",
                    "    if (e.data.type === 'summonComplete') return; // Handled by tool listener",
                    "    const { args, state, memory } = e.data;",
                    "    self.aspectMemory = memory;",
                    "    try {",
                    tool.code,
                    "        if (typeof executeTool === 'function') {",
                    "            const result = await executeTool(args, state);",
                    "            self.postMessage({ success: true, result, state });",
                    "        } else {",
                    "            self.postMessage({ success: false, error: \"Function executeTool(args, state) is not defined in this script. Ensure you have 'async function executeTool(args, state) { ... }' in your tool.\" });",
                    "        }",
                    "    } catch (err) {",
                    "        self.postMessage({ success: false, error: err.message });",
                    "    }",
                    "};"
                ].join('\n');
                const blob = new Blob([workerCode], { type: 'application/javascript' });
                const workerUrl = URL.createObjectURL(blob);
                const worker = new Worker(workerUrl);
                
                // Initialize tool.state if it doesn't exist
                if (!tool.state) tool.state = {};
                
                const result = await new Promise((resolve, reject) => {
                    let timeoutId;
                    let onAbort;

                    const cleanup = () => {
                        if (timeoutId) clearTimeout(timeoutId);
                        if (onAbort && state.abortController) {
                            state.abortController.signal.removeEventListener('abort', onAbort);
                        }
                    };

                    timeoutId = setTimeout(() => {
                        worker.terminate();
                        URL.revokeObjectURL(workerUrl);
                        cleanup();
                        reject(new Error("Tool execution timed out after 10 seconds."));
                    }, 10000);

                    onAbort = () => {
                        worker.terminate();
                        URL.revokeObjectURL(workerUrl);
                        cleanup();
                        reject(new Error("Tool execution aborted."));
                    };

                    if (state.abortController) {
                        state.abortController.signal.addEventListener('abort', onAbort);
                    }

                    worker.onmessage = async (e) => {
                        if (!e || !e.data) return;

                        if (e.data.type === 'writeMemory') {
                            (async () => {
                                try {
                                    if (!aspect.memory) aspect.memory = {};
                                    aspect.memory[e.data.key] = e.data.value;
                                    await saveMemory(aspect.id, aspect.memory);
                                    worker.postMessage({ type: 'memoryWriteComplete', messageId: e.data.messageId });
                                } catch (err) {
                                    console.error("Failed to save aspect memory", err);
                                    worker.postMessage({ type: 'memoryWriteComplete', messageId: e.data.messageId, error: err.message });
                                }
                            })();
                            return; // Keep worker alive for the final result
                        }

                        if (e.data.type === 'summonAspect') {
                            const { aspectName, prompt, messageId } = e.data;
                            const targetAspect = state.aspects.find(a => a.name.toLowerCase() === aspectName.toLowerCase());
                            if (!targetAspect) {
                                worker.postMessage({ type: 'summonComplete', messageId, error: `Aspect '${aspectName}' not found.` });
                                return;
                            }

                            try {
                                const response = await fetchAIResponseForAspect(targetAspect, prompt);
                                worker.postMessage({ type: 'summonComplete', messageId, response });
                            } catch (err) {
                                worker.postMessage({ type: 'summonComplete', messageId, error: err.message });
                            }
                            return; // Keep worker alive
                        }

                        cleanup();
                        if (e.data.success) {
                            tool.state = e.data.state; // Update state
                            markChangesUnsaved();
                            resolve(e.data.result);
                        } else {
                            reject(new Error(e.data.error || "Unknown tool execution error"));
                        }
                        worker.terminate();
                        URL.revokeObjectURL(workerUrl);
                    };
                    worker.onerror = (err) => {
                        cleanup();
                        reject(new Error(err.message || "Worker execution failed due to a syntax or runtime error."));
                        worker.terminate();
                        URL.revokeObjectURL(workerUrl);
                    };
                    worker.postMessage({ args: parsedArgs, state: tool.state, memory: aspect.memory || {} });
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
            let newAgenticToolCalls = [];

            for (let tc of toolCalls) {
                const logId = addSystemLog(`Executing tool \`${tc.name}\`...`);
                const result = await executeJavaScriptTool(tc.name, tc.args);
                updateSystemLog(logId, `🛠️ **Tool Executed:** \`${tc.name}\`\n\n**Result:**\n\`\`\`json\n${result}\n\`\`\``);
                toolResultsText += `Tool ${tc.name} returned:\n${result}\n\n`;

                // Agentic loop: check if the tool returned an instruction to call another tool
                let innerMatch;
                const innerToolCallRegex = /\[Run Tool:\s*([a-zA-Z0-9_\-\.]+)(?:\((.*?)\))?\s*\]/g;
                while ((innerMatch = innerToolCallRegex.exec(result)) !== null) {
                    newAgenticToolCalls.push({
                        fullMatch: innerMatch[0],
                        name: innerMatch[1],
                        args: innerMatch[2] || ""
                    });
                }
            }

            if (!state.consecutiveToolRuns) state.consecutiveToolRuns = 0;
            state.consecutiveToolRuns++;
            
            if (state.consecutiveToolRuns > 15) {
                addSystemLog("⚠️ Loop protection triggered: Maximum of 15 consecutive tool runs reached.");
                state.consecutiveToolRuns = 0;
                return;
            }

            if (newAgenticToolCalls.length > 0) {
                // If tools returned new tools to run, immediately run them by spoofing an AI response containing them
                let spoofedMessage = newAgenticToolCalls.map(tc => tc.fullMatch).join("\n");
                addSystemLog("⚡ **Agentic Loop triggered**: Tool requested immediate execution of another tool.");
                await processAIResponseAndTools(spoofedMessage, aspect);
                return;
            }

            await sendAIRequest(toolResultsText);
        }




        export function abortAIRequest() {
            if (state.abortController) {
                state.abortController.abort();
            }
        }

        export async function sendAIRequest(extraContext) {
            const aspect = getCurrentAspect();
            if (!aspect) return;

            setChatLoadingState(true);

            const writingId = addSystemLog(`*${aspect.name} is reflecting...*`);
            
            state.abortController = new AbortController();

            try {
                if (!state.settings.apiUrl || !state.settings.apiKey) {
                    throw new Error("API credentials not configured. Please click the Gear icon in the sidebar to configure them.");
                }

                const extraFileText = await getKnowledgeFilesText(aspect.id);
                const systemPrompt = buildSystemPrompt(aspect, extraFileText);
                const apiMessages = buildApiMessages(aspect, systemPrompt, extraContext, state.settings.maxContext);

                const endpoint = getApiEndpoint(state.settings.apiUrl);

                let response;
                try {
                    response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${state.settings.apiKey}`
                    },
                    body: JSON.stringify({
                        model: state.settings.model,
                        messages: apiMessages,
                        temperature: 0.7,
                        stream: true
                    }),
                    signal: state.abortController.signal
                    });
                } catch (err) {
                    if (err.name === 'AbortError') throw err;
                    throw new Error(`Network error: ${err.message}`);
                }

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    const errMsg = errData.error?.message || response.statusText;
                    throw new Error(`API error ${response.status}: ${errMsg}`);
                }
                
                const reader = response.body.getReader();

                const idx = aspect.chatHistory.findIndex(m => m.id === writingId);
                if (idx !== -1) {
                    aspect.chatHistory.splice(idx, 1);
                }
                renderChatMessages();

                let aiMessage = "";
                try {
                    aiMessage = await handleStreamResponse(reader, createStreamingBubble, updateStreamingBubble);
                } catch (e) {
                    if (e.name === 'AbortError') {
                        addSystemLog(`⚠️ **Generation stopped by user.**`);
                        renderChatMessages();
                        return;
                    }
                    throw e;
                }

                await processAIResponseAndTools(aiMessage, aspect);

            } catch (error) {
                const idx = aspect.chatHistory.findIndex(m => m.id === writingId);
                if (idx !== -1) {
                    aspect.chatHistory.splice(idx, 1);
                }
                addSystemLog(`❌ **Error:** ${error.message}`);
            } finally {
                setChatLoadingState(false);
                renderChatMessages();
                state.abortController = null;
            }
        }


        export async function sendMessage() {
            const input = document.getElementById('chat-input');
            const text = input.value.trim();
            if (!text) return;

            const aspect = getCurrentAspect();
            if (!aspect) return;
            
            // Check for @AspectName mention at the beginning
            const summonMatch = text.match(/^@([a-zA-Z0-9_\-]+)\s+(.*)$/s);
            if (summonMatch) {
                const targetName = summonMatch[1];
                const prompt = summonMatch[2];
                const targetAspect = state.aspects.find(a => a.name.toLowerCase() === targetName.toLowerCase());

                if (targetAspect) {
                    aspect.chatHistory.push({ role: 'user', content: text });
                    renderChatMessages();
                    markChangesUnsaved();

                    const logId = addSystemLog(`Summoning \`${targetAspect.name}\`...`);
                    document.getElementById('send-btn').disabled = true;

                    try {
                        const response = await fetchAIResponseForAspect(targetAspect, prompt);

                        updateSystemLog(logId, `✨ **${targetAspect.name} responds:**

${response}`);

                        // Let the current aspect know about this interaction
                        const extraContext = `User summoned ${targetAspect.name} with prompt: "${prompt}".\n${targetAspect.name} responded: "${response}"`;

                        document.getElementById('send-btn').disabled = false;
                        input.value = '';
                        input.style.height = 'auto';
                        await sendAIRequest(extraContext);
                        return;
                    } catch (err) {
                        updateSystemLog(logId, `❌ **Failed to summon ${targetAspect.name}:** ${err.message}`);
                        document.getElementById('send-btn').disabled = false;
                        return;
                    }
                }
            }

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
