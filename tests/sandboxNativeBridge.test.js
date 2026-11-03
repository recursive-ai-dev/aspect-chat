import { describe, it, expect, vi } from 'vitest';
import { sandboxBootstrap } from '../src/js/modules/sandboxBootstrap.js';
import { runSandboxedTool } from '../src/js/modules/toolSandbox.js';

function bootstrap(bridgeVisible) {
    const handlers = [];
    const send = vi.fn();
    const executeTool = vi.fn().mockResolvedValue('safe result');
    const document = { createElement: vi.fn(() => ({})), body: { appendChild: vi.fn() } };
    const self = { addEventListener: (_event, handler) => handlers.push(handler) };
    if (bridgeVisible) self.androidBridge = { postMessage: vi.fn() };
    // The modern parent's bridge remains outside the opaque frame's globals.
    const parent = { postMessage: send, androidBridge: { postMessage: vi.fn() } };
    new Function('self', 'parent', 'document', 'executeTool', `(${sandboxBootstrap.toString()})();`)(self, parent, document, executeTool);
    const dispatch = data => handlers[0]({ data: { channel: '__CHANNEL__', ...data } });
    return { self, parent, document, executeTool, send, dispatch };
}

describe('native bridge sandbox isolation', () => {
    it('refuses all tool code when a legacy bridge is exposed and still tears down', async () => {
        const run = bootstrap(true);
        expect(run.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'ready' }), '*');
        await run.dispatch({ type: 'init', code: 'androidBridge.postMessage("native escape")', args: {}, state: {}, memory: { private: 1 } });
        expect(run.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'done', ok: false, error: expect.stringContaining('Update Android System WebView') }), '*');
        expect(run.document.createElement).not.toHaveBeenCalled();
        expect(run.executeTool).not.toHaveBeenCalled();
        expect(run.self.androidBridge.postMessage).not.toHaveBeenCalled();
        expect(run.self.aspectMemory).toBeUndefined();
        await run.dispatch({ type: 'teardown' });
        expect(run.send).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'teardown-complete' }), '*');
    });

    it('runs tools when an origin-restricted bridge exists only in the parent', async () => {
        const run = bootstrap(false);
        await run.dispatch({ type: 'init', code: 'function executeTool() {}', args: { x: 1 }, state: {} });
        expect(run.document.body.appendChild).toHaveBeenCalledOnce();
        expect(run.executeTool).toHaveBeenCalledWith({ x: 1 }, {});
        expect(run.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'done', ok: true, result: 'safe result' }), '*');
        expect(run.parent.androidBridge.postMessage).not.toHaveBeenCalled();
    });

    it('keeps untrusted code out of srcdoc until the checked init handshake', async () => {
        const code = '/* hostile payload marker */ androidBridge.postMessage("escape");';
        let html, init;
        const run = runSandboxedTool({ code, args: {}, state: {}, _createFrame: source => {
            html = source;
            const channel = source.match(/const channel = '([^']+)'/)[1];
            const reply = data => window.dispatchEvent(new MessageEvent('message', { data: { channel, ...data } }));
            const frame = { parentNode: { removeChild: vi.fn() }, contentWindow: { postMessage: message => {
                if (message.type === 'init') { init = message; reply({ type: 'done', ok: false, error: 'Unsafe native bridge' }); }
                if (message.type === 'teardown') reply({ type: 'teardown-complete' });
            } } };
            queueMicrotask(() => reply({ type: 'ready' }));
            return frame;
        } });
        await expect(run).rejects.toThrow('Unsafe native bridge');
        expect(html).not.toContain('hostile payload marker');
        expect(init.code).toBe(code);
    });
});
