import { defineConfig } from 'vite';
import { sandboxBootstrap } from './src/js/modules/sandboxBootstrap.js';

function sandboxPagePlugin() {
    // A real document gets its own CSP. srcdoc inherits the app's production
    // policy, which intentionally forbids inline tool code.
    const boot = sandboxBootstrap.toString().replace(/(['"])__CHANNEL__\1/, 'location.hash.slice(1)');
    const html = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; style-src 'none'"><body><script>(${boot})();</script>`;
    return {
        name: 'tool-sandbox-page',
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                if (req.url?.split('?')[0]?.endsWith('/tool-sandbox.html')) {
                    res.setHeader('Content-Type', 'text/html');
                    res.end(html);
                } else next();
            });
        },
        generateBundle() { this.emitFile({ type: 'asset', fileName: 'tool-sandbox.html', source: html }); }
    };
}

/**
 * Swap the baseline Content-Security-Policy meta in index.html for the strict
 * production policy (or inject it if the baseline tag is absent).
 *
 * Build-only: Vite's dev server relies on inline scripts and eval for HMR, so a
 * strict CSP there would break `npm run dev`. index.html ships a permissive
 * baseline for the served-directly case; here we replace it so the built app
 * locks down hard and never carries two competing CSP tags.
 *
 * `connect-src *` is intentional and unavoidable: the whole point of Aspect
 * Studio is talking to whatever OpenAI-compatible endpoint the user configures
 * (localhost, a hosted provider, a custom URL), and WebLLM fetches model weights
 * from a CDN. Everything else is restricted.
 */
function cspPlugin() {
    const csp = [
        "default-src 'self'",
        "script-src 'self' 'wasm-unsafe-eval' blob:",
        "worker-src 'self' blob:",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src * data: blob:",
        // Tool code runs in an `about:srcdoc` sandboxed iframe (toolSandbox.js).
        "frame-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'none'"
        // Note: frame-ancestors is intentionally omitted — it is ignored in a
        // <meta> CSP. Set it via an HTTP header at the hosting layer if needed.
    ].join('; ');

    const strictTag = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
    const existing = /<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/i;

    return {
        name: 'inject-csp-meta',
        apply: 'build',
        transformIndexHtml(html) {
            return existing.test(html)
                ? html.replace(existing, strictTag)
                : html.replace('<head>', `<head>\n    ${strictTag}`);
        }
    };
}

export default defineConfig({
    base: './',
    plugins: [cspPlugin(), sandboxPagePlugin()],
    build: {
        // Set just above the `webllm` chunk. @mlc-ai/web-llm is ~6 MB as one
        // indivisible library; it is already isolated into its own lazily-
        // imported chunk that loads only when a user selects the in-browser
        // engine, so the reporter's "use dynamic import()" advice is fully
        // applied and its warning here was pure noise. Every other chunk we
        // ship is under 500 kB, so this threshold still flags a real blow-up.
        chunkSizeWarningLimit: 6200,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (!id.includes('node_modules')) return;
                    if (id.includes('@mlc-ai/web-llm')) return 'webllm';
                    if (id.includes('@huggingface') || id.includes('onnxruntime')) return 'embeddings';
                    if (id.includes('pdfjs-dist')) return 'pdfjs';
                    if (id.includes('mammoth')) return 'mammoth';
                    if (id.includes('jszip')) return 'jszip';
                    if (id.includes('codemirror') || id.includes('@codemirror') || id.includes('@lezer')) return 'codemirror';
                    if (id.includes('dompurify') || id.includes('marked')) return 'markdown';
                    return 'vendor';
                }
            }
        }
    }
});
