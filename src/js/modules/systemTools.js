export const systemTools = [
    {
        name: 'Calculator.js',
        description: 'A basic math calculator for evaluating expressions safely.',
        code: `// Calculator tool for basic math
// Usage: executeTool({ expression: "2 + 2" })
async function executeTool(args, state) {
    const expr = args.expression || args;
    if (!expr) return "No expression provided.";
    try {
        // Safe evaluation of basic math
        if (/^[0-9+\\-*/().\\s]+$/.test(expr)) {
            const res = new Function("return " + expr)();
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
