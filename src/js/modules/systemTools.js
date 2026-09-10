export const systemTools = [
    {
        name: 'Calculator.js',
        description: 'A basic math calculator for evaluating expressions safely.',
        code: `// Calculator tool for basic math
// Usage: executeTool({ expression: "2 + 2" })
async function executeTool(args, state) {
    const expr = args.expression || args;
    if (!expr) return "No expression provided.";

    // Safe mathematical expression evaluator
    const evaluate = (expression) => {
        // Remove spaces for easier tokenization, though the regex mostly handles it
        // We'll tokenize keeping numbers and operators
        const tokens = expression.match(/\\d+\\.\\d+|\\d+|[-+*/()]/g) || [];
        if (tokens.length === 0) throw new Error("No valid tokens found");
        let pos = 0;

        const parseFactor = () => {
            if (pos >= tokens.length) throw new Error("Unexpected end of expression");
            let sign = 1;
            while (tokens[pos] === '+' || tokens[pos] === '-') {
                if (tokens[pos++] === '-') sign = -sign;
            }
            if (pos >= tokens.length) throw new Error("Unexpected end of expression");

            if (tokens[pos] === '(') {
                pos++;
                const val = parseExpression();
                if (pos >= tokens.length || tokens[pos] !== ')') throw new Error("Missing closing parenthesis");
                pos++;
                return sign * val;
            }
            const val = parseFloat(tokens[pos++]);
            if (isNaN(val)) throw new Error("Invalid number");
            return sign * val;
        };

        const parseTerm = () => {
            let val = parseFactor();
            while (pos < tokens.length && (tokens[pos] === '*' || tokens[pos] === '/')) {
                const op = tokens[pos++];
                const nextVal = parseFactor();
                if (op === '*') val *= nextVal;
                else val /= nextVal;
            }
            return val;
        };

        const parseExpression = () => {
            let val = parseTerm();
            while (pos < tokens.length && (tokens[pos] === '+' || tokens[pos] === '-')) {
                const op = tokens[pos++];
                const nextVal = parseTerm();
                if (op === '+') val += nextVal;
                else val -= nextVal;
            }
            return val;
        };

        const result = parseExpression();
        if (pos < tokens.length) throw new Error("Unexpected tokens at end of expression");
        return result;
    };

    try {
        if (/^[0-9+\\\-/*().\\s]+$/.test(expr)) {
            const res = evaluate(expr);
            return { result: res };
        }
        return { error: "Invalid math expression characters." };
    } catch (e) {
        return { error: e.message };
    }
}`
    },
    {
        name: 'Weather.js',
        description: 'Mock weather tool returning serene conditions.',
        code: `// Weather tool that returns serene weather descriptions
// Usage: executeTool({ location: "Redwoods" })
async function executeTool(args, state) {
    const loc = args.location || "Redwoods";
    const conditions = [
        "A gentle mist rolls across the water, keeping the area cool. 62°F.",
        "Golden rays of sunshine break through the canopy. 74°F.",
        "A soft, serene drizzle falls. 58°F.",
        "Clear evening skies with a crisp breeze. 50°F."
    ];
    const index = Math.abs(loc.length + new Date().getMinutes()) % conditions.length;
    return {
        location: loc,
        condition: conditions[index],
        serenityLevel: "Maximum"
    };
}`
    },
    {
        name: 'DateTime.js',
        description: 'Returns the current local date and time.',
        code: `// Time tool returning the local date and time
// Usage: executeTool({})
async function executeTool(args, state) {
    const now = new Date();
    return {
        time: now.toLocaleTimeString(),
        date: now.toLocaleDateString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    };
}`
    },
    {
        name: 'ReadMemory.js',
        description: 'Read from the Aspect\'s persistent memory. Supports reading a single key, all keys under a namespace prefix, or listing all keys.',
        code: `// Read from persistent memory across sessions
// Usage: executeTool({ key: "userName" })
// Usage: executeTool({ namespace: "projects/myapp" })   → returns all keys under that prefix, stripped
// Usage: executeTool({ list: true })                    → returns sorted array of all keys
// Usage: executeTool({ list: true, namespace: "projects" }) → sorted keys under prefix
async function executeTool(args, state) {
    const memory = self.aspectMemory || {};

    // List mode: return sorted array of keys, optionally filtered by namespace
    if (args.list) {
        const prefix = args.namespace || args.prefix || null;
        const keys = Object.keys(memory);
        const filtered = prefix ? keys.filter(k => k.startsWith(prefix)) : keys;
        return { keys: filtered.sort() };
    }

    // Namespace mode: return all keys under the prefix with the prefix stripped
    if (args.namespace || args.prefix) {
        const prefix = args.namespace || args.prefix;
        const normalized = prefix.endsWith('/') ? prefix : prefix + '/';
        const result = {};
        for (const key of Object.keys(memory)) {
            if (key.startsWith(normalized)) {
                result[key.slice(normalized.length)] = memory[key];
            }
        }
        return { namespace: prefix, values: result };
    }

    // Single key mode (supports ephemeral ~ keys)
    if (!args.key) return { error: "Must provide a 'key', 'namespace', or set 'list: true'." };
    return { key: args.key, value: memory[args.key] !== undefined ? memory[args.key] : null };
}`
    },
    {
        name: 'WriteMemory.js',
        description: 'Write a key-value pair to the Aspect\'s persistent memory. Use ephemeral:true or a ~ prefix for session-only values that are never saved to disk.',
        code: `// Write to persistent memory across sessions
// Usage: executeTool({ key: "userName", value: "Alice" })
// Usage: executeTool({ key: "~session-counter", value: 1 })          → ephemeral (session only)
// Usage: executeTool({ key: "session-counter", value: 1, ephemeral: true }) → also ephemeral
async function executeTool(args, state) {
    if (!args.key) return { error: "Must provide a 'key' to write." };
    if (args.value === undefined) return { error: "Must provide a 'value' to write." };

    // If ephemeral flag is set and key doesn't already start with ~, prefix it
    let key = args.key;
    if (args.ephemeral && !key.startsWith('~')) {
        key = '~' + key;
    }

    // We send a special postMessage type to the main thread to handle DB writes
    return new Promise((resolve) => {
        const messageId = Date.now().toString() + Math.random();

        const listener = (e) => {
            if (e.data.type === 'memoryWriteComplete' && e.data.messageId === messageId) {
                self.removeEventListener('message', listener);
                resolve({ success: true, key: key, value: args.value, ephemeral: key.startsWith('~') });
            }
        };
        self.addEventListener('message', listener);

        self.postMessage({
            type: 'writeMemory',
            key: key,
            value: args.value,
            messageId: messageId
        });
    });
}`
    },
    {
        name: 'MemoryWatch.js',
        description: 'Register a named listener on a memory key. When that key is written, a notification appears in the chat transcript.',
        code: `// Register a listener label for a memory key
// When the key is written via WriteMemory, a notification is logged to the transcript.
// Usage: executeTool({ key: "projects/todos", label: "TodoWatcher" })
async function executeTool(args, state) {
    if (!args.key) return { error: "Must provide 'key'" };
    return new Promise((resolve) => {
        const messageId = Date.now().toString() + Math.random();
        const listener = (e) => {
            if (e.data.type === 'memoryWatchComplete' && e.data.messageId === messageId) {
                self.removeEventListener('message', listener);
                resolve({ success: true, key: args.key, label: args.label || 'watcher' });
            }
        };
        self.addEventListener('message', listener);
        self.postMessage({ type: 'watchMemory', key: args.key, label: args.label || 'watcher', messageId });
    });
}`
    },
    {

    name: 'SummonAspect.js',
    description: 'Summons another Aspect and sends a prompt to them, returning their response. Use when you need help from another AI.',
    code: `// Summons another Aspect by name and waits for their response
// Usage: executeTool({ aspectName: "Tester", prompt: "Please review my code: ..." })
async function executeTool(args, state) {
    if (!args.aspectName) return { error: "Must provide 'aspectName'" };
    if (!args.prompt) return { error: "Must provide 'prompt'" };

    // We send a special postMessage type to the main thread to handle summoning
    return new Promise((resolve) => {
        const messageId = Date.now().toString() + Math.random();

        const listener = (e) => {
            if (e.data.type === 'summonComplete' && e.data.messageId === messageId) {
                self.removeEventListener('message', listener);
                if (e.data.error) {
                    resolve({ success: false, error: e.data.error });
                } else {
                    resolve({ success: true, aspectName: args.aspectName, response: e.data.response });
                }
            }
        };
        self.addEventListener('message', listener);

        self.postMessage({
            type: 'summonAspect',
            aspectName: args.aspectName,
            prompt: args.prompt,
            messageId: messageId
        });
    });
}`
    },
    {
        name: 'RegexTester.js',
        description: 'Tests one or more strings against a regex pattern. Returns match results and capture groups. Optionally benchmarks throughput at 10k iterations.',
        code: `// Regex tester — pure in-sandbox, no network
// Usage: executeTool({ pattern: "^(\\\\w+)@(\\\\w+\\\\.\\\\w+)$", flags: "i", corpus: ["user@example.com", "bad"], benchmark: false })
async function executeTool(args, state) {
    if (!args.pattern) return { error: "Must provide 'pattern'." };

    let re;
    try {
        re = new RegExp(args.pattern, args.flags || '');
    } catch (e) {
        return { error: "Invalid regex: " + e.message };
    }

    const inputs = Array.isArray(args.corpus)
        ? args.corpus
        : (args.corpus !== undefined && args.corpus !== null ? [String(args.corpus)] : []);

    if (inputs.length === 0) return { error: "Must provide 'corpus' (string or array of strings)." };

    const results = inputs.map((input) => {
        // Reset lastIndex for stateful (global/sticky) regexes on each input
        re.lastIndex = 0;
        const m = re.exec(String(input));
        if (!m) return { input, matched: false, match: null, groups: [] };

        const groups = m.slice(1).map((g, i) => ({ index: i + 1, value: g !== undefined ? g : null }));
        const namedGroups = m.groups ? Object.entries(m.groups).map(([name, value]) => ({ name, value })) : [];
        return {
            input,
            matched: true,
            match: m[0],
            index: m.index,
            groups,
            namedGroups: namedGroups.length > 0 ? namedGroups : undefined
        };
    });

    const output = { pattern: args.pattern, flags: args.flags || '', results };

    if (args.benchmark) {
        const ITERATIONS = 10000;
        // Build a fresh regex without 'g'/'y' flags to avoid lastIndex drift in timing loop
        const benchFlags = (args.flags || '').replace(/[gy]/g, '');
        const benchRe = new RegExp(args.pattern, benchFlags);
        const sample = inputs[0];
        const t0 = performance.now();
        for (let i = 0; i < ITERATIONS; i++) {
            benchRe.exec(sample);
        }
        const elapsed = performance.now() - t0;
        const opsPerSec = Math.round((ITERATIONS / elapsed) * 1000);
        output.benchmark = {
            iterations: ITERATIONS,
            elapsedMs: Math.round(elapsed * 100) / 100,
            opsPerSec,
            testedOn: sample
        };
    }

    return output;
}`
    },
    {
        name: 'ASTParser.js',
        description: 'Parses JSON (with type annotations) or tokenizes JavaScript source into a flat token list with a summary. Supports dot-notation query for JSON mode.',
        code: `// AST/token parser — pure in-sandbox, no network
// Usage (JSON): executeTool({ source: '{"a":1}', mode: "json", query: "a" })
// Usage (JS):   executeTool({ source: "const x = 1;", mode: "js" })
async function executeTool(args, state) {
    if (args.source === undefined || args.source === null) return { error: "Must provide 'source'." };
    const source = String(args.source);
    const mode = args.mode || 'json';

    // ── JSON MODE ─────────────────────────────────────────────────────────────
    if (mode === 'json') {
        let parsed;
        try {
            parsed = JSON.parse(source);
        } catch (e) {
            return { error: "JSON parse error: " + e.message };
        }

        // Recursively annotate leaves with their typeof
        const annotate = (node) => {
            if (node === null) return { value: null, type: 'null' };
            const t = typeof node;
            if (t !== 'object') return { value: node, type: t };
            if (Array.isArray(node)) {
                return { type: 'array', items: node.map(annotate) };
            }
            const out = { type: 'object', properties: {} };
            for (const [k, v] of Object.entries(node)) {
                out.properties[k] = annotate(v);
            }
            return out;
        };

        const annotated = annotate(parsed);

        // Optional dot-notation query on the raw parsed value (not annotated)
        if (args.query) {
            const parts = String(args.query).split('.');
            let cur = parsed;
            for (const part of parts) {
                if (cur === null || cur === undefined) break;
                // Support numeric indices for arrays
                const idx = /^\\d+$/.test(part) ? parseInt(part, 10) : part;
                cur = cur[idx];
            }
            return {
                query: args.query,
                result: cur !== undefined ? cur : null,
                resultType: cur === null ? 'null' : typeof cur,
                annotated
            };
        }

        return { mode: 'json', annotated };
    }

    // ── JS TOKENIZER MODE ─────────────────────────────────────────────────────
    if (mode === 'js') {
        const JS_KEYWORDS = new Set([
            'break','case','catch','class','const','continue','debugger','default',
            'delete','do','else','export','extends','false','finally','for',
            'function','if','import','in','instanceof','let','new','null','return',
            'static','super','switch','this','throw','true','try','typeof','undefined',
            'var','void','while','with','yield','async','await','of'
        ]);

        const tokens = [];
        let i = 0;
        const len = source.length;

        while (i < len) {
            // Skip whitespace
            if (/\\s/.test(source[i])) { i++; continue; }

            // Line comment
            if (source[i] === '/' && source[i + 1] === '/') {
                let start = i;
                while (i < len && source[i] !== '\\n') i++;
                tokens.push({ type: 'comment', value: source.slice(start, i) });
                continue;
            }

            // Block comment
            if (source[i] === '/' && source[i + 1] === '*') {
                let start = i;
                i += 2;
                while (i < len - 1 && !(source[i] === '*' && source[i + 1] === '/')) i++;
                i += 2;
                tokens.push({ type: 'comment', value: source.slice(start, i) });
                continue;
            }

            // String literals (single, double, template)
            if (source[i] === '"' || source[i] === "'" || source[i] === '\`') {
                const quote = source[i];
                let start = i++;
                while (i < len) {
                    if (source[i] === '\\\\') { i += 2; continue; }
                    if (source[i] === quote) { i++; break; }
                    i++;
                }
                tokens.push({ type: 'string', value: source.slice(start, i) });
                continue;
            }

            // Numbers
            if (/\\d/.test(source[i]) || (source[i] === '.' && /\\d/.test(source[i + 1]))) {
                let start = i;
                // Hex
                if (source[i] === '0' && (source[i + 1] === 'x' || source[i + 1] === 'X')) {
                    i += 2;
                    while (i < len && /[0-9a-fA-F]/.test(source[i])) i++;
                } else {
                    while (i < len && /[\\d.]/.test(source[i])) i++;
                    if (i < len && (source[i] === 'e' || source[i] === 'E')) {
                        i++;
                        if (i < len && (source[i] === '+' || source[i] === '-')) i++;
                        while (i < len && /\\d/.test(source[i])) i++;
                    }
                }
                tokens.push({ type: 'number', value: source.slice(start, i) });
                continue;
            }

            // Identifiers / keywords
            if (/[a-zA-Z_$]/.test(source[i])) {
                let start = i;
                while (i < len && /[\\w$]/.test(source[i])) i++;
                const word = source.slice(start, i);
                tokens.push({ type: JS_KEYWORDS.has(word) ? 'keyword' : 'identifier', value: word });
                continue;
            }

            // Multi-char operators
            const twoChar = source.slice(i, i + 3);
            const threeCharOps = ['===', '!==', '**=', '>>>=', '...'];
            const threeFound = threeCharOps.find(op => twoChar.startsWith(op) && source.slice(i, i + op.length) === op);
            if (threeFound) {
                tokens.push({ type: 'operator', value: threeFound });
                i += threeFound.length;
                continue;
            }
            const twoCharOps = ['==','!=','<=','>=','&&','||','??','++','--','+=','-=','*=','/=','%=','**','<<','>>','>>>','&=','|=','^=','=>','?.'];
            const twoFound = twoCharOps.find(op => source.slice(i, i + 2) === op);
            if (twoFound) {
                tokens.push({ type: 'operator', value: twoFound });
                i += 2;
                continue;
            }

            // Punctuation vs operator (single char)
            const ch = source[i];
            if ('(){}[];,.:'.includes(ch)) {
                tokens.push({ type: 'punctuation', value: ch });
            } else {
                tokens.push({ type: 'operator', value: ch });
            }
            i++;
        }

        // Summary counts by type
        const summary = {};
        for (const tok of tokens) {
            summary[tok.type] = (summary[tok.type] || 0) + 1;
        }

        return { mode: 'js', tokens, summary, nodeCount: tokens.length };
    }

    return { error: "Unknown mode '" + mode + "'. Use 'json' or 'js'." };
}`
    },
    {
        name: 'CanvasRenderer.js',
        description: 'Renders SVG or HTML content directly into the chat as a visual block. Use to display diagrams, charts, or rich HTML layouts inline.',
        code: `// Renders SVG or HTML content into the chat bubble
// Usage: executeTool({ type: "svg", content: "<svg>...</svg>", width: 400, height: 300, caption: "My diagram" })
// type: 'svg' | 'html'
async function executeTool(args, state) {
    if (!args.content) return { error: "Must provide 'content' (SVG markup or HTML string)." };

    const renderType = args.type || 'svg';
    if (renderType !== 'svg' && renderType !== 'html') {
        return { error: "Invalid 'type'. Use 'svg' or 'html'." };
    }

    const width = (typeof args.width === 'number' && args.width > 0) ? args.width : 400;
    const height = (typeof args.height === 'number' && args.height > 0) ? args.height : 300;
    const caption = typeof args.caption === 'string' ? args.caption : '';

    return new Promise((resolve) => {
        const messageId = Date.now().toString() + Math.random();

        const listener = (e) => {
            if (e.data.type === 'renderCanvasComplete' && e.data.messageId === messageId) {
                self.removeEventListener('message', listener);
                if (e.data.error) {
                    resolve({ success: false, error: e.data.error });
                } else {
                    resolve({ success: true, renderType, width, height });
                }
            }
        };
        self.addEventListener('message', listener);

        self.postMessage({
            type: 'renderCanvas',
            content: args.content,
            renderType,
            width,
            height,
            caption,
            messageId
        });
    });
}`
    },
    {
        name: 'GitInspector.js',
        description: 'Inspect a local git repository via the git-bridge server. Supports status, diff, and log actions. Requires the git-bridge server to be running locally (cd git-bridge && node server.js).',
        code: `/**
 * GitInspector tool — reads git repository information via the local git-bridge
 * server (git-bridge/server.js in the Aspect Studio project).
 *
 * Before using this tool, start the bridge in a terminal:
 *   cd git-bridge
 *   node server.js          // listens on http://localhost:7432 by default
 *
 * Usage examples:
 *   executeTool({ action: "status", repo: "/home/user/my-project" })
 *   executeTool({ action: "diff",   repo: "/home/user/my-project", file: "src/main.js" })
 *   executeTool({ action: "log",    repo: "/home/user/my-project", n: 5 })
 *
 * @param {object} args
 * @param {'status'|'diff'|'log'} args.action  - The inspection action to perform
 * @param {string}  args.repo        - Absolute path to the git repository on disk
 * @param {string}  [args.file]      - (diff only) Relative path of a specific file
 * @param {number}  [args.n=10]      - (log only) Number of commits to return (max 200)
 * @param {string}  [args.bridgeUrl] - Base URL of the git-bridge server
 *                                     (default: "http://localhost:7432")
 * @returns {Promise<object>}        - Parsed JSON from the bridge, or { error: string }
 */
async function executeTool(args, state) {
    const action = args.action;
    const repo = args.repo;
    const bridgeUrl = (args.bridgeUrl || 'http://localhost:7432').replace(/\\/$/, '');

    if (!action) return { error: "Must provide 'action': 'status', 'diff', or 'log'." };
    if (!repo)   return { error: "Must provide 'repo' (absolute path to the git repository)." };

    const validActions = ['status', 'diff', 'log'];
    if (!validActions.includes(action)) {
        return { error: \`Unknown action "\${action}". Must be one of: \${validActions.join(', ')}\` };
    }

    let endpoint;

    if (action === 'status') {
        endpoint = \`\${bridgeUrl}/status?repo=\${encodeURIComponent(repo)}\`;
    } else if (action === 'diff') {
        const fileParam = args.file ? \`&file=\${encodeURIComponent(args.file)}\` : '';
        endpoint = \`\${bridgeUrl}/diff?repo=\${encodeURIComponent(repo)}\${fileParam}\`;
    } else if (action === 'log') {
        const n = args.n || 10;
        endpoint = \`\${bridgeUrl}/log?repo=\${encodeURIComponent(repo)}&n=\${encodeURIComponent(n)}\`;
    }

    try {
        const response = await fetch(endpoint);
        const data = await response.json();

        if (!response.ok) {
            return { error: data.error || \`Bridge returned HTTP \${response.status}\` };
        }

        return data;
    } catch (err) {
        if (err instanceof TypeError) {
            return {
                error: \`Could not reach git-bridge at \${bridgeUrl}. Is the server running? Start it with: cd git-bridge && node server.js\`
            };
        }
        return { error: err.message || 'Unknown error contacting git-bridge' };
    }
}`
    }
];
