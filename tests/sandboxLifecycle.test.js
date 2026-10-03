import { describe, it, expect, vi } from 'vitest';
import { runSandboxedTool } from '../src/js/modules/toolSandbox.js';
import { sandboxBootstrap } from '../src/js/modules/sandboxBootstrap.js';

function fakeFrame(onInit, tokens = []) {
    return html => {
        const channel = html.match(/const channel = '([^']+)'/)[1];
        tokens.push(channel);
        const reply = data => window.dispatchEvent(new MessageEvent('message', { data: { channel, ...data } }));
        const frame = { parentNode: { removeChild: vi.fn() }, contentWindow: { postMessage: msg => {
            if (msg.type === 'init') onInit(reply);
            if (msg.type === 'teardown') reply({ type: 'teardown-complete' });
        } } };
        queueMicrotask(() => reply({ type: 'ready' }));
        return frame;
    };
}
describe('sandbox lifecycle', () => {
    it('generates independent cryptographic UUID channels without Math.random', async () => {
        const tokens = [];
        const random = vi.spyOn(Math, 'random');
        for (let i = 0; i < 8; i++) await runSandboxedTool({ code: '', args: {}, state: {},
            _createFrame: fakeFrame(reply => reply({ type: 'done', ok: true, result: 1 }), tokens) });
        expect(new Set(tokens).size).toBe(8);
        expect(tokens.every(token => /^ch_[0-9a-f-]{36}$/.test(token))).toBe(true);
        expect(random).not.toHaveBeenCalled();
        random.mockRestore();
    });
    it.each(['abort', 'timeout'])('cancels every hung host request on %s', async mode => {
        const controller = new AbortController();
        const signals = [];
        const broker = vi.fn(req => { signals.push(req.signal); return new Promise(() => {}); });
        const promise = runSandboxedTool({ code: '', args: {}, state: {}, timeoutMs: 30, signal: controller.signal, onNetwork: broker,
            _createFrame: fakeFrame(reply => {
                reply({ type: 'net-request', id: 1, url: 'https://test.invalid/a' });
                reply({ type: 'net-request', id: 2, url: 'https://test.invalid/b' });
                if (mode === 'abort') setTimeout(() => controller.abort(), 5);
            }) });
        await expect(promise).rejects.toThrow(/aborted|timed out/);
        expect(broker).toHaveBeenCalledTimes(2);
        expect(signals.every(signal => signal.aborted)).toBe(true);
    });
    it('drains iframe fetch promises before acknowledging teardown', async () => {
        const handlers = [];
        const messages = [];
        const self = { addEventListener: (_, handler) => handlers.push(handler) };
        const parent = { postMessage: msg => messages.push(msg) };
        // Execute the actual bootstrap in a minimal isolated host, without tool
        // code, to verify its waiter map rather than matching source strings.
        new Function('self', 'parent', `(${sandboxBootstrap.toString()})();`)(self, parent);
        const first = self.fetch('https://test.invalid/a');
        const second = self.fetch('https://test.invalid/b');
        handlers[0]({ data: { channel: '__CHANNEL__', type: 'teardown' } });
        await expect(first).rejects.toThrow(/torn down/);
        await expect(second).rejects.toThrow(/torn down/);
        expect(messages.at(-1).type).toBe('teardown-complete');
    });
});
