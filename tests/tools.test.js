import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import { http, HttpResponse } from 'msw';
import { server } from './mocks/server.js';
import * as tools from '../src/js/modules/tools.js';
import { state } from '../src/js/modules/state.js';
import * as aspectsModule from '../src/js/modules/aspects.js';
import * as uiModule from '../src/js/modules/ui.js';
import * as chatModule from '../src/js/modules/chat.js';
import * as dbModule from '../src/js/modules/db.js';

vi.mock('../src/js/modules/aspects.js', () => ({
    getCurrentAspect: vi.fn(),
}));

vi.mock('../src/js/modules/ui.js', () => ({
    markChangesUnsaved: vi.fn(),
    setChatLoadingState: vi.fn(),
    addSystemLog: vi.fn(),
    updateSystemLog: vi.fn(),
    renderConversationList: vi.fn()
}));

vi.mock('../src/js/modules/chat.js', () => ({
    renderChatMessages: vi.fn(),
    createStreamingBubble: vi.fn().mockReturnValue({}),
    updateStreamingBubble: vi.fn()
}));

vi.mock('../src/js/modules/db.js', () => ({
    getKnowledgeFilesText: vi.fn().mockResolvedValue('Extra file knowledge'),
    saveMemory: vi.fn()
}));

describe('Tools Module', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.settings = {
            apiUrl: 'https://api.test.com/v1',
            apiKey: 'test-key',
            model: 'test-model',
            maxContext: 5
        };
        state.abortController = null;
        
        document.body.innerHTML = `
            <input id="chat-input" />
            <div id="tools-dropdown"></div>
            <button id="send-btn"></button>
            <button id="tools-btn"></button>
        `;
    });
    
    afterEach(() => {
        server.resetHandlers();
    });

    describe('getApiEndpoint', () => {
        it('should append /chat/completions if not present', () => {
            expect(tools.getApiEndpoint('http://api.com/v1')).toBe('http://api.com/v1/chat/completions');
            expect(tools.getApiEndpoint('http://api.com/v1/')).toBe('http://api.com/v1/chat/completions');
        });

        it('should not append if already present', () => {
            expect(tools.getApiEndpoint('http://api.com/v1/chat/completions')).toBe('http://api.com/v1/chat/completions');
        });
    });

    describe('fetchAIResponseForAspect', () => {
        it('should throw if no API configured', async () => {
            state.settings.apiUrl = '';
            await expect(tools.fetchAIResponseForAspect({}, 'hi')).rejects.toThrow('API credentials not configured');
        });

        it('should fetch and return AI response', async () => {
            server.use(
                http.post('https://api.test.com/v1/chat/completions', () => {
                    return HttpResponse.json({
                        choices: [{ message: { content: 'AI response' } }]
                    });
                })
            );
            const aspect = { id: '1', instructions: 'Be helpful', knowledge: 'Know nothing' };
            const res = await tools.fetchAIResponseForAspect(aspect, 'Hello');
            expect(res).toBe('AI response');
        });

        it('should throw error on non-ok response', async () => {
            server.use(
                http.post('https://api.test.com/v1/chat/completions', () => {
                    return HttpResponse.json({ error: { message: 'Invalid token' } }, { status: 401 });
                })
            );
            const aspect = { id: '1', instructions: 'Be helpful' };
            await expect(tools.fetchAIResponseForAspect(aspect, 'Hello')).rejects.toThrow('Unauthorized (401). Invalid token');
        });

        it('should throw on empty choices array', async () => {
            server.use(
                http.post('https://api.test.com/v1/chat/completions', () => {
                    return HttpResponse.json({ choices: [] });
                })
            );
            const aspect = { id: '1', instructions: 'Be helpful', knowledge: '' };
            await expect(tools.fetchAIResponseForAspect(aspect, 'Hello')).rejects.toThrow('Empty response from model');
        });
    });

    describe('executeJavaScriptTool worker source', () => {
        it('should build valid worker source even when tool code contains backticks', async () => {
            const aspect = {
                id: 'current',
                chatHistory: [],
                tools: [{ name: 't', code: 'async function executeTool(args, state) { const msg = `hi ${args.x}`; return msg; }' }]
            };
            state.currentAspectId = 'current';
            aspectsModule.getCurrentAspect.mockReturnValue(aspect);

            const RealBlob = global.Blob;
            let capturedCode = null;
            global.Blob = class { constructor(parts) { capturedCode = parts.join(''); } };
            global.URL.createObjectURL = vi.fn().mockReturnValue('mock-url');
            global.URL.revokeObjectURL = vi.fn();
            global.Worker = class Worker {
                constructor() {}
                postMessage() { this.onmessage({ data: { success: true, result: 'ok', state: {} } }); }
                terminate() {}
            };

            const result = await tools.executeJavaScriptTool('t', '{"x":"there"}');

            global.Blob = RealBlob;
            delete global.URL.createObjectURL;
            delete global.URL.revokeObjectURL;
            delete global.Worker;

            expect(result).toContain('ok');
            expect(capturedCode).toContain('`hi ${args.x}`');
            expect(() => new Function(capturedCode)).not.toThrow();
        });
    });

    describe('insertToolTag', () => {
        it('should append tool tag to chat input and hide dropdown', () => {
            const input = document.getElementById('chat-input');
            const dropdown = document.getElementById('tools-dropdown');
            dropdown.classList.add('show');
            input.value = 'Hello';
            
            tools.insertToolTag('myTool');
            
            expect(input.value).toBe('Hello [Run Tool: myTool]');
            expect(dropdown.classList.contains('show')).toBe(false);
        });
    });

    describe('Logging tools', () => {
        it('should add system log and render chat', () => {
            const aspect = { chatHistory: [] };
            aspectsModule.getCurrentAspect.mockReturnValue(aspect);
            const logId = tools.addSystemLog('Test log');
            
            expect(aspect.chatHistory.length).toBe(1);
            expect(aspect.chatHistory[0].role).toBe('system');
            expect(aspect.chatHistory[0].content).toBe('Test log');
            expect(chatModule.renderChatMessages).toHaveBeenCalled();
        });

        it('should update system log and mark unsaved', () => {
            const aspect = { chatHistory: [{ id: '123', role: 'system', content: 'Old' }] };
            aspectsModule.getCurrentAspect.mockReturnValue(aspect);
            tools.updateSystemLog('123', 'New');
            
            expect(aspect.chatHistory[0].content).toBe('New');
            expect(chatModule.renderChatMessages).toHaveBeenCalled();
            expect(uiModule.markChangesUnsaved).toHaveBeenCalled();
        });
    });

    describe('sendMessage', () => {
        it('should return early if input is empty', async () => {
            document.getElementById('chat-input').value = '   ';
            await tools.sendMessage();
            expect(aspectsModule.getCurrentAspect).not.toHaveBeenCalled();
        });

        it('opens Settings and keeps the text when no provider is configured', async () => {
            state.settings = { provider: 'custom', apiUrl: '', apiKey: '', model: '' };
            const aspect = { chatHistory: [] };
            aspectsModule.getCurrentAspect.mockReturnValue(aspect);
            const openSettings = vi.fn();
            window.openSettings = openSettings;

            const input = document.getElementById('chat-input');
            input.value = 'hello there';
            await tools.sendMessage();

            expect(openSettings).toHaveBeenCalled();
            expect(input.value).toBe('hello there'); // not consumed
            expect(aspect.chatHistory).toHaveLength(0);

            delete window.openSettings;
        });

        it('should summon another aspect if @AspectName is used', async () => {
            const aspect = { chatHistory: [] };
            state.aspects = [
                { id: 'current', name: 'Current Aspect', chatHistory: [] },
                { id: 'target', name: 'TargetAspect', chatHistory: [], tools: [] }
            ];
            state.currentAspectId = 'current';
            aspectsModule.getCurrentAspect.mockReturnValue(aspect);

            const input = document.getElementById('chat-input');
            input.value = '@TargetAspect hello there';
            
            server.use(
                http.post('https://api.test.com/v1/chat/completions', () => {
                    return HttpResponse.json({ choices: [{ message: { content: 'Target AI Response' } }] });
                })
            );

            await tools.sendMessage();
            // Chat history of CURRENT aspect should have the summon response
            expect(aspect.chatHistory.length).toBeGreaterThan(0);
            expect(aspect.chatHistory[0].content).toBe('@TargetAspect hello there');
        });

        it('should push user message to history and call sendAIRequest', async () => {
            const aspect = { chatHistory: [] };
            aspectsModule.getCurrentAspect.mockReturnValue(aspect);
            document.getElementById('chat-input').value = 'Hello';

            let fetchCalled = false;
            server.use(
                http.post('https://api.test.com/v1/chat/completions', () => {
                    fetchCalled = true;
                    return HttpResponse.json({ choices: [{ message: { content: 'AI Response' } }] });
                })
            );

            await tools.sendMessage();
            
            expect(aspect.chatHistory.length).toBeGreaterThanOrEqual(1);
            expect(aspect.chatHistory[0].content).toBe('Hello');
            expect(document.getElementById('chat-input').value).toBe('');
            expect(chatModule.renderChatMessages).toHaveBeenCalled();
            expect(uiModule.markChangesUnsaved).toHaveBeenCalled();
            expect(fetchCalled).toBe(true);
        });

        it('should process user tool calls', async () => {
            const aspect = { chatHistory: [], tools: [{name: 'myTool', code: 'return 42'}] };
            aspectsModule.getCurrentAspect.mockReturnValue(aspect);
            document.getElementById('chat-input').value = 'Testing [Run Tool: myTool]';
            
            let fetchCalled = false;
            server.use(
                http.post('https://api.test.com/v1/chat/completions', async ({ request }) => {
                    fetchCalled = true;
                    const body = await request.json();
                    expect(JSON.stringify(body)).toContain('User executed tool myTool');
                    return HttpResponse.json({ choices: [{ message: { content: 'AI Response' } }] });
                })
            );
            // Because internal calls cannot be spied easily in ES modules without dependency injection,
            // we will just let it run and mock the Worker globally
            global.Worker = class Worker {
                constructor() {
                    this.postMessage = (data) => {
                        this.onmessage({ data: { success: true, result: '42', state: {} } });
                    };
                    this.terminate = vi.fn();
                }
            };
            global.URL.createObjectURL = vi.fn().mockReturnValue('mock-url');
            global.URL.revokeObjectURL = vi.fn();

            await tools.sendMessage();

            delete global.Worker;
            delete global.URL.createObjectURL;
            delete global.URL.revokeObjectURL;

            expect(fetchCalled).toBe(true);
        });
    });

    describe('sendAIRequest stream handling', () => {
        it('should handle API errors appropriately', async () => {
            const aspect = { name: 'Aspect 1', chatHistory: [] };
            aspectsModule.getCurrentAspect.mockReturnValue(aspect);
            
            server.use(
                http.post('https://api.test.com/v1/chat/completions', () => {
                    return HttpResponse.error();
                })
            );

            // Mock renderChatMessages or similar to verify error handling
            const chatModule = await import('../src/js/modules/chat.js');
            vi.spyOn(chatModule, 'renderChatMessages').mockImplementation(() => {});

            await tools.sendAIRequest('some context');

            expect(document.getElementById('send-btn').disabled).toBe(false);
        });

        it('should handle failed summon', async () => {
            const aspect = { chatHistory: [] };
            state.aspects = [
                { id: 'current', name: 'Current Aspect', chatHistory: [] },
                { id: 'target', name: 'FailAspect', chatHistory: [], tools: [] }
            ];
            state.currentAspectId = 'current';
            aspectsModule.getCurrentAspect.mockReturnValue(aspect);
            state.settings = { apiUrl: 'https://api.test.com', apiKey: 'test', model: 'test-model' };
            server.use(
                http.post('https://api.test.com/chat/completions', () => {
                    return HttpResponse.error();
                })
            );

            const input = document.getElementById('chat-input');
            input.value = '@FailAspect hello';
            
            await tools.sendMessage();
            
            // Should catch the error and reset button
            expect(document.getElementById('send-btn').disabled).toBe(false);
            expect(aspect.chatHistory.some(m => String(m.content).includes('Failed to summon'))).toBe(true);
        });
        
        it('should handle AbortError during stream', async () => {
            const aspect = { chatHistory: [] };
            aspectsModule.getCurrentAspect.mockReturnValue(aspect);
            state.settings = { apiUrl: 'https://api.test.com', apiKey: 'test', model: 'test-model' };
            
            // Note: sendAIRequest accesses state.abortController
            state.abortController = new AbortController();
            
            // Mock fetch to return a reader that throws AbortError
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                body: {
                    getReader: () => ({
                        read: () => Promise.reject(new DOMException('Aborted', 'AbortError')),
                        releaseLock: vi.fn()
                    })
                }
            });
            
            // Removed mock for addSystemLog as it is in tools.js
            
            await tools.sendAIRequest();
            
            expect(aspect.chatHistory.some(m => String(m.content).includes('Generation stopped by user'))).toBe(true);
        });

        it('should handle missing credentials', async () => {
            const aspect = { chatHistory: [] };
            aspectsModule.getCurrentAspect.mockReturnValue(aspect);
            state.settings = { apiUrl: '', apiKey: '' };
            await tools.sendAIRequest();
            expect(aspect.chatHistory.some(m => String(m.content).includes('API credentials not configured'))).toBe(true);
        });

        it('should ignore partial JSON in handleStreamResponse', async () => {
            const aspect = { chatHistory: [] };
            aspectsModule.getCurrentAspect.mockReturnValue(aspect);
            state.settings = { apiUrl: 'https://api.test.com', apiKey: 'test', model: 'test-model' };
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                body: {
                    getReader: () => {
                        let calls = 0;
                        return {
                            read: () => {
                                calls++;
                                if (calls === 1) {
                                    return Promise.resolve({ done: false, value: new TextEncoder().encode('data: {"choices": [{"delta": {"content": "He"}}]}\ndata: {"choi') });
                                } else if (calls === 2) {
                                    return Promise.resolve({ done: false, value: new TextEncoder().encode('ces": [{"delta": {"content": "llo"}}]}\n') });
                                }
                                return Promise.resolve({ done: true });
                            },
                            releaseLock: vi.fn()
                        };
                    }
                }
            });
            await tools.sendAIRequest();
            expect(aspect.chatHistory[aspect.chatHistory.length - 1].content).toContain('Hello');
        });

        it('should include a final SSE line that lacks a trailing newline', async () => {
            const aspect = { chatHistory: [] };
            aspectsModule.getCurrentAspect.mockReturnValue(aspect);
            state.settings = { apiUrl: 'https://api.test.com', apiKey: 'test', model: 'test-model' };
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                body: {
                    getReader: () => {
                        let calls = 0;
                        return {
                            read: () => {
                                calls++;
                                if (calls === 1) {
                                    return Promise.resolve({ done: false, value: new TextEncoder().encode('data: {"choices": [{"delta": {"content": "Hel"}}]}\ndata: {"choices": [{"delta": {"content": "lo"}}]}') });
                                }
                                return Promise.resolve({ done: true });
                            },
                            releaseLock: vi.fn()
                        };
                    }
                }
            });
            await tools.sendAIRequest();
            expect(aspect.chatHistory[aspect.chatHistory.length - 1].content).toBe('Hello');
        });
    });
    
    describe('abortAIRequest', () => {
        it('should abort if controller exists', () => {
            state.abortController = new AbortController();
            const spy = vi.spyOn(state.abortController, 'abort');
            tools.abortAIRequest();
            expect(spy).toHaveBeenCalled();
        });
    });

    describe('tools dropdown outside-click handler', () => {
        it('should close tools dropdown when clicking outside', () => {
            document.body.innerHTML = `
                <button id="tools-btn">Tools</button>
                <div id="tools-dropdown" class="show"></div>
                <div id="outside"></div>
            `;

            const dropdown = () => document.getElementById('tools-dropdown');
            expect(dropdown().classList.contains('show')).toBe(true);

            // Clicking the Tools button itself must leave the menu open.
            document.getElementById('tools-btn').dispatchEvent(
                new MouseEvent('click', { bubbles: true })
            );
            expect(dropdown().classList.contains('show')).toBe(true);

            // Clicking anywhere else closes it.
            document.getElementById('outside').dispatchEvent(
                new MouseEvent('click', { bubbles: true })
            );
            expect(dropdown().classList.contains('show')).toBe(false);
        });
    });
});
