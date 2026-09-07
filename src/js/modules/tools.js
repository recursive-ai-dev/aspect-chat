import { renderChatMessages, createStreamingBubble, updateStreamingBubble } from './chat.js';
import { getKnowledgeFilesText, saveMemory } from './db.js';
import { markChangesUnsaved, setChatLoadingState, renderConversationList } from './ui.js';
import { getCurrentAspect, isToolTrusted } from './aspects.js';
import { state, getGenerationParams } from './state.js';
import { touchActiveConversation } from './conversations.js';
import {
    streamChatWithFallback,
    completeChat,
    primaryTarget,
    fallbackTarget,
    hasUsableProvider,
    readSSEStream
} from './llm.js';
import { getApiEndpoint, buildHeaders } from './providers.js';
import { runSandboxedTool } from './toolSandbox.js';

export { getApiEndpoint };

let knowledgeTruncationWarned = false;

/** Test-only: reset the once-per-session truncation warning. */
export function resetKnowledgeWarningForTesting() {
    knowledgeTruncationWarned = false;
}

export function buildSystemPrompt(aspect, extraFileText, maxKnowledgeChars) {
    const manual = aspect.knowledge || 'None.';
    let combined = `${manual}${extraFileText || ''}`;

    const cap = Number.isFinite(maxKnowledgeChars) && maxKnowledgeChars > 0
        ? maxKnowledgeChars
        : Infinity;

    if (combined.length > cap) {
        const original = combined.length;
        combined = combined.slice(0, cap) +
            `\n\n[Knowledge truncated: ${original.toLocaleString()} characters exceeded the ` +
            `${cap.toLocaleString()}-character limit. Trim this Aspect's knowledge bank / attached ` +
            `files, or raise "Max knowledge characters" in API Settings.]`;

        if (!knowledgeTruncationWarned && typeof window !== 'undefined' && typeof window.showToast === 'function') {
            knowledgeTruncationWarned = true;
            window.showToast(
                `This Aspect's knowledge (${original.toLocaleString()} chars) was truncated to fit the ` +
                `${cap.toLocaleString()}-char limit. Adjust it in the editor or API Settings.`,
                'error'
            );
        }
    }

    return `${aspect.instructions}

# Knowledge Bank
${combined}`;
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

/**
 * Stream an OpenAI-style SSE body into a chat bubble.
 *
 * The bubble is created lazily on the first content chunk so a request that
 * errors before producing any text never leaves an empty bubble behind.
 * Kept as a thin wrapper over `readSSEStream` so the parsing lives in one place.
 */
export async function handleStreamResponse(reader, createStreamingBubble, updateStreamingBubble) {
    let bubbleElement = null;

    const aiMessage = await readSSEStream(reader, (_delta, full) => {
        if (!bubbleElement) bubbleElement = createStreamingBubble();
        updateStreamingBubble(bubbleElement, full);
    });

    // Final unthrottled paint so the last tokens are never left unrendered.
    if (bubbleElement) updateStreamingBubble(bubbleElement, aiMessage, true);
    return aiMessage;
}


        /**
         * Ask another Aspect a one-shot question (the @mention / SummonAspect path).
         *
         * Non-streaming: there is no bubble to stream into, the answer is folded
         * into the calling Aspect's context. Honours the fallback provider for
         * the same reason the main chat path does.
         */
        export async function fetchAIResponseForAspect(aspect, prompt, signal) {
            const primary = primaryTarget(state.settings);
            if (!primary.isWebLLM && !primary.url) {
                throw new Error("API credentials not configured.");
            }

            const extraFileText = await getKnowledgeFilesText(aspect.id);
            const systemPrompt = buildSystemPrompt(aspect, extraFileText, state.settings.maxKnowledgeChars);

            const apiMessages = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: prompt }
            ];

            const params = getGenerationParams(aspect);

            try {
                return await completeChat({ target: primary, messages: apiMessages, params, signal });
            } catch (err) {
                if (err && err.name === 'AbortError') throw err;
                const secondary = fallbackTarget(state.settings);
                if (!secondary) throw err;
                return completeChat({ target: secondary, messages: apiMessages, params, signal });
            }
        }

        export async function executeJavaScriptTool(toolName, argStr) {
            const aspect = getCurrentAspect();
            const tool = aspect.tools.find(t => t.name === toolName);
            if (!tool) {
                return JSON.stringify({ error: `Tool "${toolName}" not found.` });
            }
            // Trust is per tool, keyed by a hash of its code: an imported tool,
            // or one whose code changed since it was reviewed, stays inert until
            // the user opens it in the editor and enables it.
            if (!isToolTrusted(tool)) {
                return JSON.stringify({
                    error: `The tool "${toolName}" has not been reviewed (or its code changed since it was). ` +
                        `Open it in the editor, read the code, then enable it before running it.`
                });
            }
            try {
                let parsedArgs = {};
                const trimmed = argStr && argStr.trim();
                if (trimmed) {
                    try {
                        parsedArgs = JSON.parse(trimmed);
                    } catch (e) {
                        // A bare string is a valid argument for tools that want
                        // one. But something that clearly *meant* to be JSON and
                        // failed should come back as an error the model can fix,
                        // not be passed through half-parsed.
                        if (/^[{[]/.test(trimmed)) {
                            return JSON.stringify({
                                error: `Could not parse the arguments to "${toolName}" as JSON: ${e.message}. ` +
                                    `Send valid JSON, e.g. [Run Tool: ${toolName}({"key":"value"})].`
                            });
                        }
                        parsedArgs = trimmed;
                    }
                }

                if (!tool.state) tool.state = {};

                const timeoutMs = Number.isFinite(state.settings.toolTimeoutMs) && state.settings.toolTimeoutMs > 0
                    ? state.settings.toolTimeoutMs
                    : 30000;

                const { result, state: nextState } = await runSandboxedTool({
                    code: tool.code,
                    args: parsedArgs,
                    state: tool.state,
                    memory: aspect.memory || {},
                    timeoutMs,
                    signal: state.abortController ? state.abortController.signal : undefined,
                    onPrivileged: (msg, post) => handlePrivilegedToolMessage(aspect, msg, post),
                    onNetwork: (req) => brokerToolFetch(aspect, tool, req)
                });

                // The sandbox mutates a structured-clone copy of state; adopt it,
                // but refuse a runaway blob (persisted to IndexedDB and baked
                // into every .aspect export).
                if (nextState && typeof nextState === 'object') {
                    let size = 0;
                    try { size = JSON.stringify(nextState).length; } catch { size = Infinity; }
                    if (size > MAX_TOOL_STATE_CHARS) {
                        return JSON.stringify({
                            error: `"${toolName}" tried to persist ${size.toLocaleString()} characters of state; ` +
                                `the limit is ${MAX_TOOL_STATE_CHARS.toLocaleString()}. State was not saved.`
                        });
                    }
                    tool.state = nextState;
                }
                markChangesUnsaved();
                return typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
            } catch (err) {
                return JSON.stringify({ error: `Runtime error in ${toolName}: ${err.message}` });
            }
        }

        const MAX_TOOL_STATE_CHARS = 256 * 1024;

        /**
         * Relay a system-tool's privileged request (WriteMemory / SummonAspect)
         * to the main thread and post the matching *-Complete reply back into
         * the sandbox. `post` targets the sandbox frame for this run only.
         */
        async function handlePrivilegedToolMessage(aspect, msg, post) {
            if (msg.type === 'writeMemory') {
                try {
                    if (!aspect.memory) aspect.memory = {};
                    aspect.memory[msg.key] = msg.value;
                    await saveMemory(aspect.id, aspect.memory);
                    post({ type: 'memoryWriteComplete', messageId: msg.messageId });
                } catch (err) {
                    console.error('Failed to save aspect memory', err);
                    post({ type: 'memoryWriteComplete', messageId: msg.messageId, error: err.message });
                }
                return;
            }

            if (msg.type === 'summonAspect') {
                const { aspectName, prompt, messageId } = msg;
                const targetAspect = state.aspects.find(a => a.name.toLowerCase() === String(aspectName).toLowerCase());
                if (!targetAspect) {
                    post({ type: 'summonComplete', messageId, error: `Aspect '${aspectName}' not found.` });
                    return;
                }
                try {
                    const response = await fetchAIResponseForAspect(
                        targetAspect, prompt, state.abortController ? state.abortController.signal : undefined
                    );
                    post({ type: 'summonComplete', messageId, response });
                } catch (err) {
                    post({ type: 'summonComplete', messageId, error: err.message });
                }
            }
        }

        /** The scheme+host of a URL, or null if it will not parse. */
        function requestOrigin(url) {
            try {
                return new URL(String(url), (typeof location !== 'undefined' && location.href) || undefined).origin;
            } catch {
                return null;
            }
        }

        /**
         * Append a one-line system-log entry recording a tool's outbound
         * request, so every network call a tool makes is visible in the
         * transcript rather than happening silently. Best-effort: a logging
         * failure must never block or break the request itself.
         */
        function logToolNetwork(aspect, toolName, req, note) {
            try {
                const safeName = String(toolName).replace(/[^a-zA-Z0-9_\-.]/g, '').slice(0, 64) || 'tool';
                const url = String(req && req.url || '').slice(0, 300).replace(/`{1,}/g, '');
                const method = String(req && req.method || 'GET').replace(/[^A-Z]/gi, '').slice(0, 10) || 'GET';
                const line = `🌐 **Tool network${note ? ` (${note})` : ''}:** \`${safeName}\` → ${method} ${url}`;
                if (aspect && Array.isArray(aspect.chatHistory)) {
                    aspect.chatHistory.push({
                        id: Date.now().toString() + Math.random().toString(),
                        role: 'system',
                        content: line
                    });
                    if (typeof renderChatMessages === 'function') renderChatMessages();
                }
            } catch (_e) { /* logging is never load-bearing */ }
        }

        /**
         * Network broker for sandboxed tools. The sandbox itself has
         * `connect-src 'none'`; every request comes here.
         *
         * The grant is scoped to an origin, not to the tool as a whole. A tool
         * that was allowed to reach `https://api.example.com` still prompts the
         * first time it tries a different origin, so an innocuous-looking first
         * request cannot silently license later exfiltration to an attacker
         * host. `tool.allowNetwork === true` set explicitly in the editor is the
         * one deliberate "any origin" override; `false` blocks everything.
         * Every request that goes out is written into the transcript.
         */
        export async function brokerToolFetch(aspect, tool, req) {
            if (tool.allowNetwork === false) {
                return { ok: false, error: `Network access is disabled for the tool "${tool.name}".` };
            }

            const origin = requestOrigin(req.url);
            if (!origin) {
                return { ok: false, error: `The tool "${tool.name}" requested an invalid URL.` };
            }

            const allowed = Array.isArray(tool.allowedOrigins) ? tool.allowedOrigins : [];
            const originOk = tool.allowNetwork === true || allowed.includes(origin);

            if (!originOk) {
                const ask = (typeof window !== 'undefined' && window.confirm)
                    ? window.confirm.bind(window)
                    : () => false;
                const granted = ask(
                    `The tool "${tool.name}" wants to make a network request:\n\n` +
                    `  ${req.method} ${req.url}\n\n` +
                    `Allow this tool to reach ${origin}? Once allowed, it can send any data ` +
                    `to that host. Other hosts will ask again. This choice is remembered ` +
                    `until you change it in the tool editor.`
                );
                if (!granted) {
                    logToolNetwork(aspect, tool.name, req, 'blocked');
                    return { ok: false, error: `Network access to ${origin} was denied for the tool "${tool.name}".` };
                }
                tool.allowedOrigins = allowed.concat(origin);
                markChangesUnsaved();
            }

            logToolNetwork(aspect, tool.name, req);

            try {
                const resp = await fetch(req.url, {
                    method: req.method || 'GET',
                    headers: req.headers || undefined,
                    body: req.body
                });
                const body = await resp.text();
                return {
                    ok: true,
                    status: resp.status,
                    statusText: resp.statusText,
                    headers: Object.fromEntries(resp.headers.entries()),
                    body
                };
            } catch (err) {
                return { ok: false, error: (err && err.message) || String(err) };
            }
        }

        /**
         * Build the Markdown for a "tool executed" system-log entry.
         *
         * `result` is the tool's raw return value — attacker-controlled for an
         * imported tool, and influenced by fetched web content for a benign one.
         * It is rendered through the chat Markdown pipeline, so:
         *   - runs of 3+ backticks are broken with a zero-width space so the
         *     value can't close the ```json fence and inject its own Markdown;
         *   - the tool name is stripped to the charset the caller regex allows;
         *   - the value is length-capped so a tool can't flood the transcript.
         * `renderMarkdown` is still the real security boundary (no data-*, no
         * style/id, no form controls); this just keeps the log well-formed.
         */
        const TOOL_LOG_RESULT_CAP = 8000;
        export function formatToolResultLog(toolName, result, { userTriggered = false } = {}) {
            const safeName = String(toolName).replace(/[^a-zA-Z0-9_\-.]/g, '').slice(0, 64) || 'tool';
            let body = typeof result === 'string' ? result : String(result ?? '');
            if (body.length > TOOL_LOG_RESULT_CAP) {
                body = body.slice(0, TOOL_LOG_RESULT_CAP) +
                    `\n… [truncated ${(body.length - TOOL_LOG_RESULT_CAP).toLocaleString()} characters]`;
            }
            body = body.replace(/`{3,}/g, m => m.split('').join('\u200B'));
            const label = userTriggered ? 'User-Triggered Tool' : 'Tool Executed';
            return `🛠️ **${label}:** \`${safeName}\`\n\n**Result:**\n\`\`\`json\n${body}\n\`\`\``;
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


        /** Longest call string we'll pull out of one `[Run Tool: …]` tag. */
        const MAX_TOOL_CALL_LEN = 20000;

        /**
         * Parse `[Run Tool: Name({...})]` calls out of a model message.
         *
         * The old regex used `\((.*?)\)`, which stopped at the first `)` — so
         * any JSON arg containing `)`, `]`, or a newline was silently truncated.
         * This walks the `(...)` with a brace/bracket/string-aware scanner so a
         * well-formed argument object survives intact.
         * Kept deliberately separate from any parsing of *tool output*.
         */
        export function parseToolCalls(text) {
            const src = String(text || '');
            const calls = [];
            const head = /\[Run Tool:\s*([a-zA-Z0-9_\-.]+)\s*/g;
            let m;
            while ((m = head.exec(src)) !== null) {
                const name = m[1];
                let i = head.lastIndex;
                let args = '';
                if (src[i] === '(') {
                    const end = scanBalanced(src, i);
                    if (end === -1) continue;            // unterminated — skip this tag
                    args = src.slice(i + 1, end).trim();
                    i = end + 1;
                }
                // allow whitespace then the closing ']'
                while (i < src.length && /\s/.test(src[i])) i++;
                if (src[i] !== ']') continue;
                if (args.length > MAX_TOOL_CALL_LEN) args = args.slice(0, MAX_TOOL_CALL_LEN);
                calls.push({ fullMatch: src.slice(m.index, i + 1), name, args });
                head.lastIndex = i + 1;
            }
            return calls;
        }

        /** Index of the `)` that closes the `(` at `open`, or -1. String-aware. */
        function scanBalanced(s, open) {
            let depth = 0;
            let quote = null;
            for (let i = open; i < s.length && i < open + MAX_TOOL_CALL_LEN; i++) {
                const c = s[i];
                if (quote) {
                    if (c === '\\') { i++; continue; }
                    if (c === quote) quote = null;
                    continue;
                }
                if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
                if (c === '(' || c === '[' || c === '{') depth++;
                else if (c === ')' || c === ']' || c === '}') {
                    depth--;
                    if (depth === 0) return i;
                }
            }
            return -1;
        }

        /**
         * Read an *explicit* chain request from a tool's return value.
         *
         * A tool opts in by returning `{ "__aspectToolCalls": [ { "name", "args" } ] }`.
         * Free-text output is never scanned for `[Run Tool: ...]` — otherwise a
         * tool that returns a fetched web page (or any other content the model
         * or a third party can influence) could trigger further tool execution
         * on its own.
         */
        function readChainedToolCalls(resultString) {
            let parsed;
            try {
                parsed = JSON.parse(resultString);
            } catch {
                return [];
            }
            if (!parsed || !Array.isArray(parsed.__aspectToolCalls)) return [];
            return parsed.__aspectToolCalls
                .filter(c => c && typeof c.name === 'string')
                .map(c => {
                    const args = typeof c.args === 'string' ? c.args : JSON.stringify(c.args || {});
                    return { fullMatch: `[Run Tool: ${c.name}(${args})]`, name: c.name, args };
                });
        }

        // Bounds on one tool-using turn. The old code only counted consecutive
        // runs (checked *after* a whole batch); a single model message could
        // still emit hundreds of `[Run Tool: …]` tags and every one would run.
        const MAX_TOOL_CALLS_PER_MESSAGE = 8;
        const MAX_CONSECUTIVE_TOOL_RUNS = 15;
        const MAX_TOOL_TURN_MS = 120000;

        export async function processAIResponseAndTools(aiMessage, aspect, toolCallsOverride = null) {
            if (aiMessage === null || aiMessage === undefined) {
                aiMessage = "";
            }

            let toolCalls = Array.isArray(toolCallsOverride)
                ? toolCallsOverride
                : parseToolCalls(aiMessage);

            if (toolCalls.length === 0) {
                aspect.chatHistory.push({ role: 'assistant', content: aiMessage });
                renderChatMessages();
                markChangesUnsaved();
                return;
            }

            // Only record a visible assistant turn for a genuine model message;
            // an internal chained-call batch has no prose to show.
            if (!toolCallsOverride) {
                aspect.chatHistory.push({ role: 'assistant', content: aiMessage });
                renderChatMessages();
                markChangesUnsaved();
            }

            if (toolCalls.length > MAX_TOOL_CALLS_PER_MESSAGE) {
                addSystemLog(`⚠️ Only the first ${MAX_TOOL_CALLS_PER_MESSAGE} of ${toolCalls.length} tool calls in this message were run.`);
                toolCalls = toolCalls.slice(0, MAX_TOOL_CALLS_PER_MESSAGE);
            }

            if (!state.consecutiveToolRuns) {
                state.consecutiveToolRuns = 0;
                state.toolTurnStartedAt = Date.now();
            }

            let toolResultsText = "";
            let newAgenticToolCalls = [];

            for (let tc of toolCalls) {
                const logId = addSystemLog(`Executing tool \`${tc.name}\`...`);
                const result = await executeJavaScriptTool(tc.name, tc.args);
                updateSystemLog(logId, formatToolResultLog(tc.name, result));
                toolResultsText += `Tool ${tc.name} returned:\n${result}\n\n`;

                newAgenticToolCalls.push(...readChainedToolCalls(result));
            }

            state.consecutiveToolRuns++;

            const elapsed = Date.now() - (state.toolTurnStartedAt || Date.now());
            if (state.consecutiveToolRuns > MAX_CONSECUTIVE_TOOL_RUNS || elapsed > MAX_TOOL_TURN_MS) {
                addSystemLog(elapsed > MAX_TOOL_TURN_MS
                    ? `⚠️ Loop protection: tool activity exceeded ${Math.round(MAX_TOOL_TURN_MS / 1000)}s for this turn.`
                    : `⚠️ Loop protection: reached ${MAX_CONSECUTIVE_TOOL_RUNS} consecutive tool runs.`);
                state.consecutiveToolRuns = 0;
                return;
            }

            if (newAgenticToolCalls.length > 0) {
                addSystemLog("⚡ **Agentic Loop triggered**: a tool explicitly requested another tool.");
                await processAIResponseAndTools("", aspect, newAgenticToolCalls);
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

            // The agentic tool loop re-enters this function (processAIResponseAndTools
            // → sendAIRequest) as a continuation. Only the outermost call owns the
            // generating state, the abort controller, and the teardown — nested
            // calls must not flip `isGenerating` off mid-turn (which would briefly
            // re-enable the composer and let the user switch conversations while
            // messages are still being appended).
            const outermost = (state.generationDepth || 0) === 0;
            state.generationDepth = (state.generationDepth || 0) + 1;

            if (outermost) {
                setChatLoadingState(true);
                state.isGenerating = true;
                if (state.abortController) {
                    state.abortController.abort();
                }
                state.abortController = new AbortController();
            }
            const signal = state.abortController ? state.abortController.signal : undefined;

            const writingId = addSystemLog(`*${aspect.name} is reflecting...*`);

            // Remove the "reflecting" placeholder wherever we leave this function.
            const dropPlaceholder = () => {
                const idx = aspect.chatHistory.findIndex(m => m.id === writingId);
                if (idx !== -1) aspect.chatHistory.splice(idx, 1);
            };

            try {
                if (signal && signal.aborted) {
                    throw new DOMException('Aborted', 'AbortError');
                }
                const extraFileText = await getKnowledgeFilesText(aspect.id);
                const systemPrompt = buildSystemPrompt(aspect, extraFileText, state.settings.maxKnowledgeChars);
                const apiMessages = buildApiMessages(aspect, systemPrompt, extraContext, state.settings.maxContext);
                const params = getGenerationParams(aspect);

                let bubbleElement = null;
                let placeholderRemoved = false;

                const aiMessage = await streamChatWithFallback({
                    settings: state.settings,
                    messages: apiMessages,
                    params,
                    signal,
                    onDelta: (_delta, full) => {
                        // Swap the placeholder for a real bubble the moment the
                        // first token lands, so the two never show at once.
                        if (!placeholderRemoved) {
                            dropPlaceholder();
                            placeholderRemoved = true;
                            renderChatMessages();
                        }
                        if (!bubbleElement) bubbleElement = createStreamingBubble();
                        updateStreamingBubble(bubbleElement, full);
                    },
                    onProgress: (report) => {
                        // WebLLM reports weight-download progress before any token.
                        if (report && report.text) {
                            updateSystemLog(writingId, `*Loading local model — ${report.text}*`);
                        }
                    },
                    onFallback: (reason, target) => {
                        updateSystemLog(writingId, `⚠️ *Primary provider failed (${reason}). Falling back to ${target.label}…*`);
                    }
                });

                if (bubbleElement) updateStreamingBubble(bubbleElement, aiMessage, true);
                if (!placeholderRemoved) {
                    dropPlaceholder();
                    renderChatMessages();
                }

                await processAIResponseAndTools(aiMessage, aspect);

            } catch (error) {
                dropPlaceholder();
                if (error.name === 'AbortError' || (signal && signal.aborted)) {
                    addSystemLog('⚠️ **Generation stopped by user.**');
                } else {
                    addSystemLog(`❌ **Error:** ${error.message}`);
                }
            } finally {
                dropPlaceholder();
                state.generationDepth = Math.max(0, (state.generationDepth || 1) - 1);

                if (state.generationDepth === 0) {
                    state.isGenerating = false;
                    setChatLoadingState(false);
                    state.abortController = null;
                    state.consecutiveToolRuns = 0;
                }

                renderChatMessages();
                touchActiveConversation(aspect);
                // The conversation's auto-title is derived from its first
                // message, so the sidebar has to repaint once the exchange
                // is complete or it keeps showing "New chat".
                renderConversationList();
                markChangesUnsaved();
            }
        }

        export async function sendMessage() {
            const input = document.getElementById('chat-input');
            const text = input.value.trim();
            if (!text) return;

            const aspect = getCurrentAspect();
            if (!aspect) return;

            if (state.isGenerating) {
                if (typeof window !== 'undefined' && window.showToast) {
                    window.showToast('Wait for the current response to finish, or press Stop.', 'error');
                }
                return;
            }

            // No provider configured yet — open Settings instead of letting the
            // request fail into an error bubble. The message stays in the box.
            if (!hasUsableProvider(state.settings)) {
                if (typeof window !== 'undefined' && window.showToast) {
                    window.showToast('Choose a provider and model to start chatting.', 'error');
                }
                if (typeof window !== 'undefined' && typeof window.openSettings === 'function') {
                    window.openSettings();
                }
                return;
            }

            // Check for @AspectName mention at the beginning
            const summonMatch = text.match(/^@([a-zA-Z0-9_\-]+)\s+(.*)$/s);
            if (summonMatch) {
                const targetName = summonMatch[1];
                const prompt = summonMatch[2];
                const targetAspect = state.aspects.find(a => a.name.toLowerCase() === targetName.toLowerCase());

                if (targetAspect) {
                    aspect.chatHistory.push({ role: 'user', content: text });
                    input.value = '';
                    input.style.height = 'auto';
                    renderChatMessages();
                    markChangesUnsaved();

                    const logId = addSystemLog(`Summoning \`${targetAspect.name}\`...`);

                    // A summon is a real generation: show the Stop button and
                    // give it an abort controller so a slow one can be cancelled.
                    state.consecutiveToolRuns = 0;
                    setChatLoadingState(true);
                    state.isGenerating = true;
                    if (state.abortController) state.abortController.abort();
                    state.abortController = new AbortController();

                    let response;
                    try {
                        response = await fetchAIResponseForAspect(
                            targetAspect, prompt, state.abortController.signal
                        );
                    } catch (err) {
                        const aborted = err && (err.name === 'AbortError' || state.abortController?.signal.aborted);
                        updateSystemLog(logId, aborted
                            ? `⚠️ **Summon of ${targetAspect.name} stopped.**`
                            : `❌ **Failed to summon ${targetAspect.name}:** ${err.message}`);
                        state.isGenerating = false;
                        setChatLoadingState(false);
                        state.abortController = null;
                        return;
                    }

                    updateSystemLog(logId, `✨ **${targetAspect.name} responds:**\n\n${response}`);
                    const extraContext = `User summoned ${targetAspect.name} with prompt: "${prompt}".\n${targetAspect.name} responded: "${response}"`;

                    // Hand off to the normal generation path, which re-arms its
                    // own state as the outermost call.
                    state.isGenerating = false;
                    setChatLoadingState(false);
                    state.abortController = null;
                    await sendAIRequest(extraContext);
                    return;
                }
            }

            aspect.chatHistory.push({ role: 'user', content: text });
            input.value = '';
            input.style.height = 'auto'; // Reset textarea height
            touchActiveConversation(aspect);
            renderChatMessages();
            markChangesUnsaved();


            state.consecutiveToolRuns = 0;

            let userToolResults = "";
            const userToolCalls = parseToolCalls(text).slice(0, MAX_TOOL_CALLS_PER_MESSAGE);

            if (userToolCalls.length > 0) {
                for (let tc of userToolCalls) {
                    const logId = addSystemLog(`Executing user-triggered tool \`${tc.name}\`...`);
                    const result = await executeJavaScriptTool(tc.name, tc.args);
                    updateSystemLog(logId, formatToolResultLog(tc.name, result, { userTriggered: true }));
                    userToolResults += `User executed tool ${tc.name} which returned:\n${result}\n\n`;
                }
            }

            await sendAIRequest(userToolResults);
        }

        // Close the tools dropdown when clicking elsewhere.
        // Uses addEventListener rather than window.onclick, which would replace
        // (and be replaced by) any other module's window-level click handler.
        if (typeof window !== 'undefined') {
            window.addEventListener('click', function(event) {
                if (!event.target.matches('#tools-btn')) {
                    const dropdown = document.getElementById('tools-dropdown');
                    if (dropdown) dropdown.classList.remove('show');
                }
            });
        }

        // Start app is now handled in main.js
