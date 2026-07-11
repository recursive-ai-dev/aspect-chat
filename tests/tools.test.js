import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { executeJavaScriptTool } from '../src/js/modules/tools.js';
import * as aspectsModule from '../src/js/modules/aspects.js';
import * as stateModule from '../src/js/modules/state.js';
import * as uiModule from '../src/js/modules/ui.js';

describe('executeJavaScriptTool', () => {
    let mockWorkerInstance;
    let postMessageSpy;

    beforeEach(() => {
        postMessageSpy = vi.fn();
        mockWorkerInstance = {
            postMessage: postMessageSpy,
            terminate: vi.fn(),
            onmessage: null,
            onerror: null
        };

        // We must override the global Worker completely before executeJavaScriptTool uses it
        global.Worker = class Worker {
            constructor(url) {
                this.url = url;
                // Copy properties to the actual instance being created
                this.postMessage = mockWorkerInstance.postMessage;
                this.terminate = mockWorkerInstance.terminate;
                // Add reference to self so we can trigger events
                mockWorkerInstance.instance = this;
            }
        };

        global.URL.createObjectURL = vi.fn().mockReturnValue('mock-url');
        global.URL.revokeObjectURL = vi.fn();
        global.Blob = class Blob { constructor(c) { this.content = c; } };

        // Mock DOM elements that might be used
        document.body.innerHTML = `
            <div id="save-reminder"></div>
        `;

        vi.spyOn(uiModule, 'markChangesUnsaved').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete global.Worker;
        delete global.URL.createObjectURL;
        delete global.URL.revokeObjectURL;
        delete global.Blob;
    });

    it('should fallback to using the string directly if JSON.parse fails on argStr', async () => {
        vi.spyOn(aspectsModule, 'getCurrentAspect').mockReturnValue({
            id: 'aspect-1',
            tools: [
                {
                    name: 'myTool',
                    code: 'async function executeTool(args) { return args; }'
                }
            ],
            memory: {}
        });

        const promise = executeJavaScriptTool('myTool', 'invalid json {[');

        // Wait for next tick so worker is created and postMessage is called
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(postMessageSpy).toHaveBeenCalledWith({
            args: 'invalid json {[',
            state: {},
            memory: {}
        });

        // Resolve the promise by triggering onmessage on the created instance
        if (mockWorkerInstance.instance && mockWorkerInstance.instance.onmessage) {
            mockWorkerInstance.instance.onmessage({
                data: {
                    success: true,
                    result: 'invalid json {[',
                    state: {}
                }
            });
        }

        const result = await promise;
        expect(result).toBe('invalid json {[');
    });

    it('should return JSON error string when tool is not found', async () => {
        vi.spyOn(aspectsModule, 'getCurrentAspect').mockReturnValue({
            id: 'aspect-1',
            tools: [], // No tools available
            memory: {}
        });

        const result = await executeJavaScriptTool('nonExistentTool', 'some args');

        expect(result).toBe(JSON.stringify({ error: `Tool "nonExistentTool" not found.` }));
    });
});
