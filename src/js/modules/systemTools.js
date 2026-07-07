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
    }
];
