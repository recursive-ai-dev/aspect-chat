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
        description: 'Read a value from the Aspect\'s long-term persistent memory.',
        code: `// Read from persistent memory across sessions
// Usage: executeTool({ key: "userName" })
async function executeTool(args, state) {
    if (!args.key) return { error: "Must provide a 'key' to read." };
    // The web worker receives 'memory' from the main thread via self.onmessage
    return { key: args.key, value: self.aspectMemory ? self.aspectMemory[args.key] : null };
}`
    },
    {
        name: 'WriteMemory.js',
        description: 'Write a key-value pair to the Aspect\'s long-term persistent memory.',
        code: `// Write to persistent memory across sessions
// Usage: executeTool({ key: "userName", value: "Alice" })
async function executeTool(args, state) {
    if (!args.key) return { error: "Must provide a 'key' to write." };
    if (args.value === undefined) return { error: "Must provide a 'value' to write." };

    // We send a special postMessage type to the main thread to handle DB writes
    return new Promise((resolve) => {
        const messageId = Date.now().toString() + Math.random();

        const listener = (e) => {
            if (e.data.type === 'memoryWriteComplete' && e.data.messageId === messageId) {
                self.removeEventListener('message', listener);
                resolve({ success: true, key: args.key, value: args.value });
            }
        };
        self.addEventListener('message', listener);

        self.postMessage({
            type: 'writeMemory',
            key: args.key,
            value: args.value,
            messageId: messageId
        });
    });
}`
    }
,
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
    }
];
