import { defineConfig } from 'vite';

/**
 * Inject a Content-Security-Policy meta tag into the built index.html.
 *
 * Build-only: Vite's dev server relies on inline scripts and eval for HMR, so a
 * strict CSP there would break `npm run dev`. In production the app is fully
 * bundled and self-hosted, so it can lock down hard.
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
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'none'"
        // Note: frame-ancestors is intentionally omitted — it is ignored in a
        // <meta> CSP. Set it via an HTTP header at the hosting layer if needed.
    ].join('; ');

    return {
        name: 'inject-csp-meta',
        apply: 'build',
        transformIndexHtml(html) {
            return html.replace(
                '<head>',
                `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}">`
            );
        }
    };
}

export default defineConfig({
    base: './',
    plugins: [cspPlugin()],
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
