import { describe, it, expect, vi, afterEach } from 'vitest';
import { runSandboxedTool } from '../src/js/modules/toolSandbox.js';

/**
 * These drive the parent-side state machine of runSandboxedTool with a fake
 * iframe. The real sandbox bootstrap runs only in a browser (jsdom won't
 * execute a sandboxed srcdoc), so here the "frame" just echoes whatever the
 * scripted behaviour says and the assertions are about orchestration:
 * handshake, init payload, network brokering, completion, timeout, abort.
 */
function makeFakeFrame(behaviour) {
    return (html) => {
        // The real bootstrap bakes the channel into its source; recover it so
        // the fake can speak on the right channel from the first message.
        const channel = (html.match(/const channel = '([^']+)'/) || [])[1];
        const parentReceive = (msg) => window.dispatchEvent(new MessageEvent('message', { data: msg }));
        const frame = {
            parentNode: { removeChild: vi.fn() },
            contentWindow: {
                postMessage: (msg) => {
                    Promise.resolve().then(() => behaviour(msg, parentReceive, channel));
                }
            }
        };
        // A real frame announces itself once its scripts boot.
        Promise.resolve().then(() => parentReceive({ channel, type: 'ready' }));
        return frame;
    };
}

afterEach(() => vi.useRealTimers());

describe('runSandboxedTool', () => {
    it('performs the handshake, sends init, and resolves with result + state', async () => {
        let initMsg = null;
        const behaviour = (msg, reply, channel) => {
            if (msg.type === 'init') {
                initMsg = msg;
                reply({ channel, type: 'done', ok: true, result: { echoed: msg.args }, state: { n: 1 } });
            }
        };
        // Capture the frame instance so we can assert it was torn down.
        const create = makeFakeFrame(behaviour);
        let frame;
        const out = await runSandboxedTool({
            code: 'x', args: { a: 1 }, state: { n: 0 }, memory: { k: 'v' },
            _createFrame: (h) => (frame = create(h))
        });

        expect(initMsg.type).toBe('init');
        expect(initMsg.args).toEqual({ a: 1 });
        expect(initMsg.memory).toEqual({ k: 'v' });
        expect(out).toEqual({ result: { echoed: { a: 1 } }, state: { n: 1 } });
        expect(frame.parentNode.removeChild).toHaveBeenCalled();
    });

    it('routes a net-request through onNetwork and returns the reply to the frame', async () => {
        const onNetwork = vi.fn().mockResolvedValue({ ok: true, status: 200, body: 'pong', headers: {} });
        let netResult = null;
        const behaviour = (msg, reply, channel) => {
            if (msg.type === 'init') {
                reply({ channel, type: 'net-request', id: 7, url: 'https://x.test', method: 'GET' });
            } else if (msg.type === 'net-result') {
                netResult = msg;
                reply({ channel, type: 'done', ok: true, result: 'ok', state: {} });
            }
        };
        const out = await runSandboxedTool({
            code: 'x', args: {}, state: {}, onNetwork,
            _createFrame: makeFakeFrame(behaviour)
        });

        expect(onNetwork).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://x.test', method: 'GET' }));
        expect(netResult).toMatchObject({ type: 'net-result', id: 7, ok: true, body: 'pong' });
        expect(out.result).toBe('ok');
    });

    it('rejects on a done:false message', async () => {
        const behaviour = (msg, reply, channel) => {
            if (msg.type === 'init') reply({ channel, type: 'done', ok: false, error: 'tool blew up' });
        };
        await expect(runSandboxedTool({
            code: 'x', args: {}, state: {}, _createFrame: makeFakeFrame(behaviour)
        })).rejects.toThrow('tool blew up');
    });

    it('times out when the frame never finishes', async () => {
        const behaviour = () => { /* never replies with done */ };
        const p = runSandboxedTool({
            code: 'x', args: {}, state: {}, timeoutMs: 20,
            _createFrame: makeFakeFrame(behaviour)
        });
        await expect(p).rejects.toThrow(/timed out/);
    });

    it('rejects immediately if the signal is already aborted', async () => {
        const ac = new AbortController();
        ac.abort();
        await expect(runSandboxedTool({
            code: 'x', args: {}, state: {}, signal: ac.signal,
            _createFrame: makeFakeFrame(() => {})
        })).rejects.toThrow(/aborted/);
    });

    it('rejects when the signal aborts mid-run', async () => {
        const ac = new AbortController();
        const behaviour = (msg) => { if (msg.type === 'init') setTimeout(() => ac.abort(), 5); };
        await expect(runSandboxedTool({
            code: 'x', args: {}, state: {}, signal: ac.signal, timeoutMs: 1000,
            _createFrame: makeFakeFrame(behaviour)
        })).rejects.toThrow(/aborted/);
    });

    it('uses an unpredictable crypto channel id (F004)', async () => {
        let html;
        const behaviour = (msg, reply, channel) => {
            if (msg.type === 'init') reply({ channel, type: 'done', ok: true, result: 1, state: {} });
        };
        const create = makeFakeFrame(behaviour);
        await runSandboxedTool({
            code: 'x', args: {}, state: {},
            _createFrame: (h) => { html = h; return create(h); }
        });
        const channel = (html.match(/const channel = '([^']+)'/) || [])[1];
        expect(channel).toMatch(/^ch_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('signals the frame to tear down before discarding it (F005)', async () => {
        const posted = [];
        const behaviour = (msg, reply, channel) => {
            posted.push(msg.type);
            if (msg.type === 'init') reply({ channel, type: 'done', ok: true, result: 1, state: {} });
        };
        await runSandboxedTool({
            code: 'x', args: {}, state: {}, _createFrame: makeFakeFrame(behaviour)
        });
        await Promise.resolve();
        expect(posted).toContain('teardown');
    });
});
