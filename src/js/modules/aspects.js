import { deleteAspectData } from './db.js';
import { applyAspectBackground } from './ui.js';
import { showChatView } from './ui.js';
import { persistAspects } from './state.js';
import { showEditorView } from './ui.js';
import { markChangesUnsaved } from './ui.js';
import { state } from './state.js';
import { systemTools } from './systemTools.js';
import { loadAspects, deleteAspectRecord } from './persist.js';
import { normalizeConversations, newId } from './conversations.js';


        export function getLakesideSageIcon() {
            const svg = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
                <defs>
                    <linearGradient id="sky" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="#f8c390" />
                        <stop offset="60%" stop-color="#e27c5e" />
                        <stop offset="100%" stop-color="#6e8c5e" />
                    </linearGradient>
                    <clipPath id="circle">
                        <circle cx="256" cy="256" r="240" />
                    </clipPath>
                </defs>
                <circle cx="256" cy="256" r="250" fill="#3d2f26" stroke="#3d2f26" stroke-width="4" />
                <circle cx="256" cy="256" r="242" fill="#fff8ec" />
                <g clip-path="url(#circle)">
                    <rect x="0" y="0" width="512" height="512" fill="url(#sky)" />
                    <circle cx="256" cy="200" r="60" fill="#fff5d7" opacity="0.9" />
                    <polygon points="0,320 180,200 320,300 480,220 512,240 512,512 0,512" fill="#4f6b43" opacity="0.7" />
                    <polygon points="-50,380 120,290 280,360 400,280 560,390 560,512 -50,512" fill="#39502f" />
                    <rect x="0" y="380" width="512" height="132" fill="#467061" />
                    <ellipse cx="256" cy="380" rx="256" ry="10" fill="#6e8c5e" />
                    <ellipse cx="200" cy="420" rx="60" ry="3" fill="#8aab94" opacity="0.6" />
                    <ellipse cx="320" cy="450" rx="90" ry="4" fill="#8aab94" opacity="0.6" />
                    <ellipse cx="140" cy="470" rx="40" ry="2" fill="#8aab94" opacity="0.6" />
                    <polygon points="50,380 60,350 70,380" fill="#20331c" />
                    <polygon points="45,360 60,320 75,360" fill="#20331c" />
                    <polygon points="450,390 460,360 470,390" fill="#20331c" />
                    <polygon points="440,370 460,330 480,370" fill="#20331c" />
                </g>
                <circle cx="256" cy="256" r="240" fill="none" stroke="#3d2f26" stroke-width="8" />
            </svg>
            `;
            return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
        }

        export function getStudioGuideIcon() {
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
                <rect width="512" height="512" fill="#2d2d35"/>
                <circle cx="256" cy="256" r="150" fill="#cc6d4e"/>
                <path d="M 200 200 L 312 256 L 200 312 Z" fill="#f5ece1"/>
                <circle cx="256" cy="256" r="240" fill="none" stroke="#597d53" stroke-width="8" />
            </svg>`;
            return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
        }

        export function getExplorerIcon() {
            const svg = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
                <defs>
                    <linearGradient id="nightSky" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="#1b2a47" />
                        <stop offset="60%" stop-color="#2d527c" />
                        <stop offset="100%" stop-color="#f8c390" />
                    </linearGradient>
                    <clipPath id="circleClip1">
                        <circle cx="256" cy="256" r="240" />
                    </clipPath>
                </defs>
                <circle cx="256" cy="256" r="250" fill="#3d2f26" stroke="#3d2f26" stroke-width="4" />
                <circle cx="256" cy="256" r="242" fill="#fff8ec" />
                <g clip-path="url(#circleClip1)">
                    <rect x="0" y="0" width="512" height="512" fill="url(#nightSky)" />
                    <circle cx="380" cy="120" r="40" fill="#fff5d7" opacity="0.9" />
                    <circle cx="380" cy="120" r="55" fill="#fff5d7" opacity="0.2" />
                    <circle cx="120" cy="80" r="4" fill="#ffffff" opacity="0.8" />
                    <circle cx="180" cy="140" r="3" fill="#ffffff" opacity="0.6" />
                    <circle cx="240" cy="90" r="5" fill="#ffffff" opacity="0.9" />
                    <circle cx="300" cy="160" r="3" fill="#ffffff" opacity="0.7" />
                    <polygon points="0,400 120,280 240,380 400,240 512,320 512,512 0,512" fill="#2c3e50" opacity="0.8" />
                    <polygon points="-50,440 180,340 320,420 480,310 560,380 560,512 -50,512" fill="#1a252f" />
                    <path d="M 230 400 L 256 320 L 282 400 Z" fill="#e74c3c" stroke="#3d2f26" stroke-width="6" />
                    <rect x="220" y="300" width="72" height="24" rx="4" transform="rotate(-30 256 312)" fill="#f39c12" stroke="#3d2f26" stroke-width="6" />
                </g>
                <circle cx="256" cy="256" r="240" fill="none" stroke="#3d2f26" stroke-width="8" />
            </svg>
            `;
            return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
        }

        export function getTinkerIcon() {
            const svg = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
                <defs>
                    <linearGradient id="tinkerSky" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="#4a2c5a" />
                        <stop offset="60%" stop-color="#7d3c8c" />
                        <stop offset="100%" stop-color="#cc6d4e" />
                    </linearGradient>
                    <clipPath id="circleClip2">
                        <circle cx="256" cy="256" r="240" />
                    </clipPath>
                </defs>
                <circle cx="256" cy="256" r="250" fill="#3d2f26" stroke="#3d2f26" stroke-width="4" />
                <circle cx="256" cy="256" r="242" fill="#fff8ec" />
                <g clip-path="url(#circleClip2)">
                    <rect x="0" y="0" width="512" height="512" fill="url(#tinkerSky)" />
                    <text x="50" y="100" font-family="Courier, monospace" font-size="24" fill="#a569bd" opacity="0.3">&lt;code&gt;</text>
                    <text x="80" y="140" font-family="Courier, monospace" font-size="20" fill="#a569bd" opacity="0.3">const val = true;</text>
                    <text x="60" y="180" font-family="Courier, monospace" font-size="22" fill="#a569bd" opacity="0.3">let temp = 42;</text>
                    <text x="320" y="120" font-family="Courier, monospace" font-size="24" fill="#a569bd" opacity="0.3">&lt;/&gt;</text>
                    <circle cx="256" cy="250" r="100" fill="#f4d03f" stroke="#3d2f26" stroke-width="8" opacity="0.9" />
                    <circle cx="256" cy="250" r="115" fill="#f4d03f" opacity="0.25" />
                    <rect x="236" y="120" width="40" height="260" rx="6" fill="#f4d03f" stroke="#3d2f26" stroke-width="8" />
                    <rect x="120" y="230" width="260" height="40" rx="6" fill="#f4d03f" stroke="#3d2f26" stroke-width="8" />
                    <rect x="236" y="120" width="40" height="260" rx="6" fill="#f4d03f" stroke-width="0" />
                    <rect x="120" y="230" width="260" height="40" rx="6" fill="#f4d03f" stroke-width="0" />
                    <circle cx="256" cy="250" r="70" fill="#eb984e" stroke="#3d2f26" stroke-width="8" />
                    <circle cx="256" cy="250" r="30" fill="#fff5d7" stroke="#3d2f26" stroke-width="8" />
                </g>
                <circle cx="256" cy="256" r="240" fill="none" stroke="#3d2f26" stroke-width="8" />
            </svg>
            `;
            return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
        }

        export function getTravelIcon() {
            const svg = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
                <defs>
                    <linearGradient id="travelSky" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="#f5b041" />
                        <stop offset="50%" stop-color="#eb984e" />
                        <stop offset="100%" stop-color="#5499c7" />
                    </linearGradient>
                    <clipPath id="circleClip3">
                        <circle cx="256" cy="256" r="240" />
                    </clipPath>
                </defs>
                <circle cx="256" cy="256" r="250" fill="#3d2f26" stroke="#3d2f26" stroke-width="4" />
                <circle cx="256" cy="256" r="242" fill="#fff8ec" />
                <g clip-path="url(#circleClip3)">
                    <rect x="0" y="0" width="512" height="512" fill="url(#travelSky)" />
                    <ellipse cx="360" cy="180" rx="35" ry="45" fill="#e74c3c" stroke="#3d2f26" stroke-width="6" />
                    <path d="M 342 220 L 348 240 L 372 240 L 378 220 Z" fill="#eb984e" stroke="#3d2f26" stroke-width="4" />
                    <rect x="350" y="244" width="20" height="12" fill="#d35400" stroke="#3d2f26" stroke-width="4" />
                    <circle cx="120" cy="260" r="45" fill="#ffffff" opacity="0.85" />
                    <circle cx="160" cy="280" r="40" fill="#ffffff" opacity="0.85" />
                    <circle cx="80" cy="280" r="35" fill="#ffffff" opacity="0.85" />
                    <polygon points="0,512 140,320 280,512" fill="#5d6d7e" stroke="#3d2f26" stroke-width="8" />
                    <polygon points="120,512 280,260 440,512" fill="#34495e" stroke="#3d2f26" stroke-width="8" />
                    <polygon points="120,512 280,260 440,512" fill="#34495e" />
                    <polygon points="280,260 250,307 280,320 305,300 Z" fill="#ffffff" />
                </g>
                <circle cx="256" cy="256" r="240" fill="none" stroke="#3d2f26" stroke-width="8" />
            </svg>
            `;
            return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
        }

        export function getZenCoachIcon() {
            const svg = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
                <defs>
                    <linearGradient id="zenSky" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="#a3e4d7" />
                        <stop offset="60%" stop-color="#48c9b0" />
                        <stop offset="100%" stop-color="#117a65" />
                    </linearGradient>
                    <clipPath id="circleClip4">
                        <circle cx="256" cy="256" r="240" />
                    </clipPath>
                </defs>
                <circle cx="256" cy="256" r="250" fill="#3d2f26" stroke="#3d2f26" stroke-width="4" />
                <circle cx="256" cy="256" r="242" fill="#fff8ec" />
                <g clip-path="url(#circleClip4)">
                    <rect x="0" y="0" width="512" height="512" fill="url(#zenSky)" />
                    <ellipse cx="256" cy="400" rx="200" ry="40" fill="none" stroke="#e8f8f5" stroke-width="4" opacity="0.6" />
                    <ellipse cx="256" cy="400" rx="140" ry="28" fill="none" stroke="#e8f8f5" stroke-width="6" opacity="0.7" />
                    <ellipse cx="256" cy="400" rx="80" ry="16" fill="none" stroke="#e8f8f5" stroke-width="8" opacity="0.9" />
                    <path d="M 120 512 Q 130 350 110 150" fill="none" stroke="#196f3d" stroke-width="20" stroke-linecap="round" />
                    <path d="M 120 512 Q 130 350 110 150" fill="none" stroke="#229954" stroke-width="12" stroke-linecap="round" />
                    <path d="M 390 512 Q 370 300 395 100" fill="none" stroke="#196f3d" stroke-width="24" stroke-linecap="round" />
                    <path d="M 390 512 Q 370 300 395 100" fill="none" stroke="#229954" stroke-width="16" stroke-linecap="round" />
                    <ellipse cx="256" cy="400" rx="85" ry="32" fill="#566573" stroke="#3d2f26" stroke-width="6" />
                    <ellipse cx="256" cy="345" rx="65" ry="26" fill="#7f8c8d" stroke="#3d2f26" stroke-width="6" />
                    <ellipse cx="256" cy="300" rx="45" ry="20" fill="#bdc3c7" stroke="#3d2f26" stroke-width="6" />
                </g>
                <circle cx="256" cy="256" r="240" fill="none" stroke="#3d2f26" stroke-width="8" />
            </svg>
            `;
            return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
        }


        export async function loadDefaultAspects() {
            let saved = [];
            try {
                saved = await loadAspects();
            } catch (e) {
                console.error("Failed to load saved aspects", e);
                // A genuine read failure. Do NOT fall through to building and
                // persisting a fresh default library — the debounced save would
                // then purge the rows we could not read. Surface it and stop.
                if (typeof window !== 'undefined' && typeof window.showStorageError === 'function') {
                    window.showStorageError();
                }
                state.aspects = [];
                state.currentAspectId = null;
                return;
            }

            if (Array.isArray(saved) && saved.length > 0) {
                state.aspects = saved.map(a => normalizeAspect(a));
                const lastId = (typeof localStorage !== 'undefined') && localStorage.getItem('currentAspectId');
                const restored = lastId && state.aspects.find(a => a.id === lastId);
                state.currentAspectId = restored ? restored.id : state.aspects[0].id;
                renderAspectList();
                applyAspectBackground();
                showChatView();
                return;
            }

            // Create Studio Guide default
            const defaultAspect = {
                id: 'studio-guide',
                name: 'Studio Guide',
                description: 'An interactive guide to help you learn how to use Aspect Studio.',
                instructions: `You are the Aspect Studio Guide. Your job is to interactively teach the user how to use Aspect Studio.
Welcome them to the app in your first message.
Explain the concepts of Aspects (custom personas with memory, tools, and knowledge).
Explain how to set up their API keys in the Settings menu (gear icon).
Explain how to create new Aspects using the "+ New Aspect" button.
Explain how the Advanced Configuration works.
Keep your responses friendly, concise, and helpful.`,
                knowledge: `# Aspect Studio Features
- Local only web app.
- Connects to OpenAI compatible endpoints.
- Injectable JS tools.
- Custom Knowledge Banks.
- Shareable .aspect files.`,
                icon: getStudioGuideIcon(),
                background: 'alone_image_pack/lake_sunset_001.jpeg',
                tools: [
                    {
                        name: 'Calculate.js',
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
                        code: `// Weather tool that returns serene weather descriptions\n// Usage: executeTool({ location: "Redwoods" })\nfunction executeTool(args) {\n    const loc = args.location || "Redwoods";\n    const conditions = [\n        "A gentle mist rolls across the water, keeping the redwoods cool. 62°F.",\n        "Golden rays of sunshine break through the pine canopy. 74°F.",\n        "A soft, serene drizzle falls, creating concentric rings on the lake. 58°F.",\n        "Clear evening skies with a crisp breeze rustling the redwood needles. 50°F."\n    ];\n    const index = Math.abs(loc.length + new Date().getMinutes()) % conditions.length;\n    return {\n        location: loc,\n        condition: conditions[index],\n        serenityLevel: "Maximum"\n    };\n}`
                    },
                    {
                        name: 'DateTime.js',
                        code: `// Time tool returning the local date and time\n// Usage: executeTool({})\nfunction executeTool(args) {\n    const now = new Date();\n    return {\n        time: now.toLocaleTimeString(),\n        date: now.toLocaleDateString(),\n        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone\n    };\n}`
                    }
                ],
                memory: {},
                chatHistory: [
                    { role: 'assistant', content: 'Welcome to Aspect Studio! 🌸 I am the Studio Guide. I am here to help you get started. Do you want to learn how to set up your API key, or would you like to know how to create your first custom Aspect?' }
                ]
            };

            state.aspects = [normalizeAspect(defaultAspect)];
            state.currentAspectId = defaultAspect.id;
            persistAspects();
            renderAspectList();
            showChatView();
        }

        /**
         * Fill in any fields an Aspect may be missing.
         *
         * Aspects arrive from three places with slightly different shapes:
         * templates, imported .aspect files, and rows saved by older versions.
         * Normalising once here means the rest of the app can assume every
         * field exists rather than guarding at each use.
         */
        /** System-tool filenames an imported tool must not be allowed to claim. */
        export const RESERVED_TOOL_NAMES = [
            'Calculator.js', 'Weather.js', 'DateTime.js',
            'ReadMemory.js', 'WriteMemory.js', 'SummonAspect.js'
        ];

        /**
         * Fast non-cryptographic hash (FNV-1a) of a tool's source. Not a defence
         * against a collision-crafting attacker — there is nothing to collide
         * against; it is only a marker for "this exact code was reviewed". When
         * the code changes, the hash no longer matches and the tool goes inert
         * until the user opens it in the editor again.
         */
        export function hashToolCode(code) {
            const s = String(code == null ? '' : code);
            let h = 0x811c9dc5;
            for (let i = 0; i < s.length; i++) {
                h ^= s.charCodeAt(i);
                h = Math.imul(h, 0x01000193);
            }
            return (h >>> 0).toString(16);
        }

        /** A tool may run only if its current code matches the reviewed hash. */
        export function isToolTrusted(tool) {
            return !!tool && typeof tool.code === 'string' &&
                tool.trustedHash === hashToolCode(tool.code);
        }

        /** Mark every tool on the Aspect as reviewed at its current code. */
        export function trustAllTools(aspect) {
            (aspect.tools || []).forEach(t => { t.trustedHash = hashToolCode(t.code); });
            aspect.toolsReviewed = true;
        }

        export function aspectHasUntrustedTools(aspect) {
            return Array.isArray(aspect.tools) && aspect.tools.some(t => !isToolTrusted(t));
        }

        /**
         * Force a tool filename to the charset the `[Run Tool: …]` caller accepts
         * (`A-Za-z0-9_-.`), cap its length, and guarantee a `.js` suffix. Applied
         * on import (names come from a zip path) and on save (free-text input).
         */
        export function sanitizeToolName(raw) {
            let n = String(raw == null ? '' : raw).replace(/[^A-Za-z0-9_\-.]/g, '').replace(/^\.+/, '');
            n = n.slice(0, 64);
            if (!n || /^\.js$/i.test(n)) n = 'tool';
            if (!/\.js$/i.test(n)) n += '.js';
            return n;
        }

        export function normalizeAspect(aspect) {
            if (!aspect || typeof aspect !== 'object') return aspect;

            if (!aspect.id) aspect.id = newId('aspect');
            if (typeof aspect.name !== 'string') aspect.name = 'Untitled Aspect';
            if (typeof aspect.description !== 'string') aspect.description = '';
            if (typeof aspect.instructions !== 'string') aspect.instructions = '';
            if (typeof aspect.knowledge !== 'string') aspect.knowledge = '';
            if (!Array.isArray(aspect.tools)) aspect.tools = [];
            if (!aspect.memory || typeof aspect.memory !== 'object') aspect.memory = {};
            if (!aspect.params || typeof aspect.params !== 'object') aspect.params = {};

            // Trust is now per-tool, keyed by a hash of the tool's code
            // (`tool.trustedHash`). `aspect.toolsReviewed` is kept only as a
            // coarse hint for the editor banner.
            //   - undefined toolsReviewed  → legacy hand-authored Aspect: the
            //     tools were already trusted under the old model, so grandfather
            //     each one in at its current code.
            //   - toolsReviewed === false  → imported, not yet reviewed: leave
            //     trustedHash unset so every tool stays inert until reviewed.
            //   - a tool that already carries a matching trustedHash is left be.
            const grandfather = aspect.toolsReviewed !== false;
            if (aspect.toolsReviewed === undefined) aspect.toolsReviewed = true;

            aspect.tools.forEach(tool => {
                if (!tool.state || typeof tool.state !== 'object') tool.state = {};
                if (grandfather && tool.trustedHash === undefined && typeof tool.code === 'string') {
                    tool.trustedHash = hashToolCode(tool.code);
                }
            });

            return normalizeConversations(aspect);
        }

        export function getGenericIcon() {
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
                <circle cx="256" cy="256" r="256" fill="#e0e0e0" />
                <circle cx="256" cy="180" r="90" fill="#9e9e9e" />
                <path d="M100 450 C100 350, 412 350, 412 450 Z" fill="#9e9e9e" />
            </svg>`;
            return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
        }

        export const aspectTemplates = [
            {
                id: 'blank',
                name: 'Blank Aspect',
                desc: 'A fresh slate. Build your AI persona from scratch.',
                instructions: `You are a helpful AI assistant.\n\nCORE DIRECTIVE:\nAct as a helpful AI assistant.\n\nTONE:\nYour communication style should be Balanced.`,
                knowledge: '',
                icon: getGenericIcon,
                tools: []
            },
            {
                id: 'python-mentor',
                name: 'The Python Mentor',
                desc: 'A patient teacher who explains Python concepts simply.',
                instructions: `You are a Python programming mentor.\n\nCORE DIRECTIVE:\nHelp the user learn Python. Explain concepts simply and provide code examples. Do not write the entire code for them; guide them to the answer.\n\nTONE:\nYour communication style should be Casual.`,
                knowledge: `# Python Best Practices\n- Use snake_case for variables and functions.\n- Keep code DRY (Don't Repeat Yourself).\n- Use list comprehensions when appropriate.`,
                icon: getTinkerIcon,
                tools: []
            },
            {
                id: 'plot-architect',
                name: 'Creative Plot Architect',
                desc: 'A brainstorming partner for novelists and writers.',
                instructions: `You are a Creative Plot Architect.\n\nCORE DIRECTIVE:\nHelp the user brainstorm story ideas, plot twists, and character arcs. Ask probing questions to develop their narrative.\n\nTONE:\nYour communication style should be Very Casual & Friendly.`,
                knowledge: `# Story Structure\n- Setup, Inciting Incident, Rising Action, Climax, Falling Action, Resolution.\n- Focus on character growth and conflict.`,
                icon: getTravelIcon,
                tools: []
            },
            {
                id: 'data-analyst',
                name: 'The Data Analyst',
                desc: 'A strict analytical assistant with a built-in calculator.',
                instructions: `You are a Data Analyst.\n\nCORE DIRECTIVE:\nHelp the user analyze data and perform calculations. Always double check your math using the Calculator tool.\n\nTONE:\nYour communication style should be Professional.`,
                knowledge: '',
                icon: getTinkerIcon,
                tools: ['Calculator.js']
            },
            {
                id: 'web-researcher',
                name: 'Web Researcher & Summary Agent',
                desc: 'Fetches websites, extracts clean text, and stores findings in persistent memory.',
                instructions: `You are a Web Researcher and Summary Agent.\nYour task is to fetch webpages, summarize them, and keep notes in your memory.\n\nCORE DIRECTIVES:\n1. When a user provides a URL, run the FetchWebsite tool to get its text content.\n2. Write clear, structured summaries of the retrieved websites in markdown format.\n3. Identify key takeaways (definitions, statistics, names, key dates) and save them to persistent memory using WriteMemory with appropriate keys.\n4. Always check if you have existing relevant notes in your memory before writing a new report by calling ReadMemory.\n\nTONE:\nInformative, methodical, and objective.`,
                knowledge: `# Research Guidelines\n- Verify source credibility.\n- Cite URLs in all responses.\n- Structure summaries using headings: "Overview", "Key Findings", and "Significant Details".\n- Store memory values under short, descriptive camelCase keys (e.g., 'savedSummaryProjectX').`,
                icon: getExplorerIcon,
                tools: [
                    'ReadMemory.js',
                    'WriteMemory.js',
                    {
                        name: 'FetchWebsite.js',
                        code: `// Fetch website content and return stripped markdown-like text\n// Usage: executeTool({ url: "https://example.com" })\nasync function executeTool(args, state) {\n    const url = args.url;\n    if (!url) return { error: "No URL provided." };\n    try {\n        const response = await fetch(url).catch(() => null);\n        if (!response) {\n            return {\n                warning: "CORS blocking may prevent fetching directly in the browser.",\n                error: "Fetch failed. Please try a local or CORS-configured URL, or install a CORS-bypass helper."\n            };\n        }\n        const html = await response.text();\n        const cleanText = html.replace(/<script[^>]*>([\\s\\S]*?)<\\/script>/gi, "")\n                            .replace(/<style[^>]*>([\\s\\S]*?)<\\/style>/gi, "")\n                            .replace(/<[^>]+>/g, " ")\n                            .replace(/\\s+/g, " ")\n                            .trim();\n        return {\n            url,\n            status: response.status,\n            content: cleanText.slice(0, 3000) + (cleanText.length > 3000 ? "..." : "")\n        };\n    } catch (e) {\n        return { error: e.message };\n    }\n}`
                    }
                ],
                chatHistory: [
                    { role: 'assistant', content: 'Hello! I am your Web Researcher & Summary Agent. 🔍 Give me a URL, and I will fetch it, extract the key points, and keep records in my persistent memory.' }
                ]
            },
            {
                id: 'tinker-expert',
                name: 'The Tinker & Code Sandbox Expert',
                desc: 'Write and test JavaScript code snippets locally in a safe worker sandbox.',
                instructions: `You are the Tinker and Code Sandbox Expert.\nYour task is to write and reason through JavaScript code snippets for the user.\n\nCORE DIRECTIVES:\n1. Help the user implement algorithms, debug logic, or format data in JavaScript.\n2. The JSExecutor tool cannot run arbitrary code strings (disabled for security); instead, trace through the code step-by-step yourself and explain what it would output.\n3. If the user wants code to actually run, tell them to add it as a named custom tool via the Injectable JS Tools panel, which executes safely in a Web Worker sandbox.\n4. Explain code structure and provide clean, annotated code blocks.\n\nTONE:\nPrecise, analytical, and highly technical.`,
                knowledge: `# Sandbox Constraints\n- Custom tools run in a separate Web Worker thread.\n- Global variables like 'window', 'document', and 'localStorage' are not accessible.\n- You can use standard ES modules, Math, Date, and standard JS objects.\n- Always use console.log to print output.\n- The JSExecutor tool is a disabled placeholder: it will not run chat-provided code strings. Real execution only happens through named custom tools the user adds.`,
                icon: getTinkerIcon,
                tools: [
                    'Calculator.js',
                    {
                        name: 'JSExecutor.js',
                        code: `// Execution of arbitrary chat-provided JavaScript strings is disabled in this sandbox for security.\n// Usage: executeTool({ code: "const a = 5; console.log(a * 2);" })\nasync function executeTool(args, state) {\n    const code = args.code;\n    if (!code) return { error: "No code provided." };\n    return {\n        success: false,\n        logs: [],\n        error: "Dynamic execution of chat-provided code strings is disabled for security. Define your logic as a named custom tool instead (Injectable JS Tools), where 'executeTool(args, state)' contains your code directly and runs in the same Web Worker sandbox."\n    };\n}`
                    }
                ],
                chatHistory: [
                    { role: 'assistant', content: 'Greetings! I am the Tinker & Code Sandbox Expert. ⚙️ Give me some JavaScript code to run or a problem to solve, and I will test it live in my sandbox.' }
                ]
            },
            {
                id: 'travel-planner',
                name: 'The Serene Travel Planner',
                desc: 'Creates calming travel plans, checks weather, and manages custom trip itineraries.',
                instructions: `You are the Serene Travel Planner.\nYour task is to help the user discover beautiful, calming destinations and build personalized travel itineraries.\n\nCORE DIRECTIVES:\n1. Suggest scenic, low-stress travel destinations using your Knowledge Bank.\n2. Use the Weather tool to check conditions for recommended spots.\n3. Use the DateTime tool to check dates or local times if planning time-specific schedules.\n4. Use the ItineraryBuilder tool to add destinations and activities to the user's travel schedule.\n\nTONE:\nCalming, warm, and inviting.`,
                knowledge: `# Scenic Serene Destinations\n- **Kyoto Gardens, Japan**: Famous for zen gardens, cherry blossoms, and bamboo paths. Best in Spring/Autumn. Serenity: 10/10.\n- **Redwood National Park, USA**: Giant sequoia forests with cooling coastal fog. Serenity: 9.5/10.\n- **Lauterbrunnen Valley, Switzerland**: Misty waterfalls, alpine meadows, and quiet villages. Serenity: 9.8/10.\n- **Lake Tekapo, New Zealand**: Turquoise waters and pristine dark sky star gazing. Serenity: 9.7/10.`,
                icon: getTravelIcon,
                tools: [
                    'Weather.js',
                    'DateTime.js',
                    {
                        name: 'ItineraryBuilder.js',
                        code: `// Manages travel destinations and activities\n// Usage: executeTool({ action: "add", destination: "Kyoto", notes: "Cherry blossoms" })\nasync function executeTool(args, state) {\n    const action = args.action || "list";\n    if (!state.trips) state.trips = [];\n    if (action === "add") {\n        const dest = args.destination;\n        if (!dest) return { error: "No destination provided." };\n        const trip = { id: Date.now().toString(), destination: dest, notes: args.notes || "", activities: [] };\n        state.trips.push(trip);\n        return { message: "Destination added successfully.", trip };\n    } else if (action === "add_activity") {\n        const dest = args.destination;\n        const act = args.activity;\n        if (!dest || !act) return { error: "Must specify both destination and activity." };\n        const trip = state.trips.find(t => t.destination.toLowerCase() === dest.toLowerCase());\n        if (!trip) return { error: "Destination not found in itinerary." };\n        trip.activities.push(act);\n        return { message: "Activity added to " + dest, trip };\n    } else if (action === "list") {\n        return { itineraries: state.trips };\n    } else if (action === "clear") {\n        state.trips = [];\n        return { message: "Itinerary cleared." };\n    }\n    return { error: "Unknown action: " + action };\n}`
                    }
                ],
                chatHistory: [
                    { role: 'assistant', content: 'Welcome! I am your Serene Travel Planner. 🗺️ Where would you like to escape to? I can help you pick the perfect, peaceful getaway and compile a customized itinerary.' }
                ]
            },
            {
                id: 'zen-coach',
                name: 'The Zen Productivity Coach',
                desc: 'Helps organize tasks, apply time-management methods, and track progress gently.',
                instructions: `You are the Zen Productivity Coach.\nYour task is to guide the user to manage their work and time mindfully without feeling overwhelmed.\n\nCORE DIRECTIVES:\n1. Help the user prioritize tasks using the Eisenhower Matrix (urgent vs. important).\n2. Use the ManageTasks tool to add tasks, complete them, or list current items.\n3. Encourage gentle productivity practices like the Pomodoro technique or mindful single-tasking.\n\nTONE:\nReassuring, peaceful, and structured.`,
                knowledge: `# Zen Productivity Concepts\n- **Eisenhower Matrix**:\n  - Quadrant 1: Urgent & Important (Do now)\n  - Quadrant 2: Important, Not Urgent (Plan & schedule)\n  - Quadrant 3: Urgent, Not Important (Delegate)\n  - Quadrant 4: Not Urgent & Not Important (Eliminate)\n- **Pomodoro Technique**: Work for 25 minutes, rest for 5. Take a long break after 4 rounds.\n- **Mindful Focus**: Do one thing at a time with full presence.`,
                icon: getZenCoachIcon,
                tools: [
                    'DateTime.js',
                    {
                        name: 'ManageTasks.js',
                        code: `// Manages a list of user tasks\n// Usage: executeTool({ action: "add", title: "Refactor core", priority: "high" })\nasync function executeTool(args, state) {\n    const action = args.action || "list";\n    if (!state.tasks) state.tasks = [];\n    if (action === "add") {\n        const title = args.title;\n        if (!title) return { error: "Task title is required." };\n        const task = { id: Date.now().toString(), title, priority: args.priority || "medium", completed: false, createdAt: new Date().toLocaleDateString() };\n        state.tasks.push(task);\n        return { message: "Task added successfully.", task };\n    } else if (action === "complete") {\n        const id = args.taskId;\n        if (!id) return { error: "Task ID or title search query is required." };\n        const task = state.tasks.find(t => t.id === id || t.title.toLowerCase().includes(id.toLowerCase()));\n        if (!task) return { error: "Task not found." };\n        task.completed = true;\n        return { message: "Task marked complete.", task };\n    } else if (action === "list") {\n        return { tasks: state.tasks };\n    } else if (action === "delete") {\n        const id = args.taskId;\n        if (!id) return { error: "Task ID or title search query is required." };\n        const idx = state.tasks.findIndex(t => t.id === id || t.title.toLowerCase().includes(id.toLowerCase()));\n        if (idx === -1) return { error: "Task not found." };\n        const deleted = state.tasks.splice(idx, 1);\n        return { message: "Task deleted.", task: deleted[0] };\n    }\n    return { error: "Unknown action: " + action };\n}`
                    }
                ],
                chatHistory: [
                    { role: 'assistant', content: 'Breathe in, breathe out. 🧘 I am your Zen Productivity Coach. Let us organize your tasks step-by-step so you can focus with absolute clarity and peace.' }
                ]
            }
        ];

        export function createNewAspect() {
            document.getElementById('create-aspect-modal').classList.remove('hidden');

            const gallery = document.getElementById('template-gallery');
            gallery.innerHTML = '';

            aspectTemplates.forEach(template => {
                const card = document.createElement('div');
                card.className = 'template-card';

                const iconSrc = typeof template.icon === 'function' ? template.icon() : (template.icon || getGenericIcon());

                card.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                        <img src="${iconSrc}" style="width: 44px; height: 44px; border-radius: 50%; border: 2px solid var(--border-color); background: #fff;" alt="${template.name} icon" />
                        <h3 style="margin: 0;">${template.name}</h3>
                    </div>
                    <p>${template.desc}</p>
                `;

                card.onclick = () => acceptCreateAspectFromTemplate(template.id);
                gallery.appendChild(card);
            });
        }

        export function acceptCreateAspectFromTemplate(templateId) {
            const template = aspectTemplates.find(t => t.id === templateId) || aspectTemplates[0];

            const initialTools = [];
            if (template.tools) {
                template.tools.forEach(toolRef => {
                    if (typeof toolRef === 'string') {
                        const sysTool = systemTools.find(st => st.name === toolRef);
                        if (sysTool) {
                            initialTools.push({ name: sysTool.name, code: sysTool.code, state: {} });
                        }
                    } else if (typeof toolRef === 'object' && toolRef !== null) {
                        initialTools.push({
                            name: toolRef.name,
                            code: toolRef.code,
                            state: toolRef.state || {}
                        });
                    }
                });
            }

            const iconVal = typeof template.icon === 'function' ? template.icon() : (template.icon || getGenericIcon());

            const newAspect = normalizeAspect({
                id: newId('aspect'),
                name: template.name === 'Blank Aspect' ? 'New Aspect' : template.name,
                description: template.desc,
                instructions: template.instructions,
                knowledge: template.knowledge,
                icon: iconVal,
                background: template.background || 'alone_image_pack/lake_sunset_002.jpeg',
                tools: initialTools,
                memory: {},
                params: {},
                chatHistory: template.chatHistory ? JSON.parse(JSON.stringify(template.chatHistory)) : []
            });

            state.aspects.push(newAspect);
            state.currentAspectId = newAspect.id;
            renderAspectList();
            showEditorView();
            markChangesUnsaved();
            document.getElementById('create-aspect-modal').classList.add('hidden');
        }

        export function uploadCreateIcon(event) {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                window.tempCreateIcon = e.target.result;
                document.getElementById('create-aspect-icon-preview').src = e.target.result;
                document.getElementById('create-aspect-icon-filename').innerText = file.name;
            };
            reader.readAsDataURL(file);
        }

        export function acceptCreateAspect() {
            // These inputs only exist in the legacy "name and description first"
            // create flow; the template gallery is the path the UI uses today.
            const nameInput = document.getElementById('create-aspect-name-input');
            const descInput = document.getElementById('create-aspect-desc-input');
            const name = (nameInput && nameInput.value.trim()) || 'New Aspect';
            const desc = (descInput && descInput.value.trim()) || 'A brand new persona.';
            const icon = window.tempCreateIcon || getGenericIcon();

            const newAspect = normalizeAspect({
                id: newId('aspect'),
                name: name,
                description: desc,
                instructions: 'You are a helpful assistant.',
                knowledge: '',
                icon: icon,
                background: 'alone_image_pack/lake_sunset_002.jpeg',
                tools: [],
                memory: {},
                params: {},
                chatHistory: []
            });
            state.aspects.push(newAspect);
            state.currentAspectId = newAspect.id;
            renderAspectList();
            showEditorView();
            markChangesUnsaved();
            document.getElementById('create-aspect-modal').classList.add('hidden');
        }
        
        export function cancelCreateAspect() {
            window.tempCreateIcon = null;
            document.getElementById('create-aspect-modal').classList.add('hidden');
        }

        export function selectAspect(id) {
            state.currentAspectId = id;
            // Remember the selection so a reload reopens where the user left off.
            try {
                if (typeof localStorage !== 'undefined') localStorage.setItem('currentAspectId', id);
            } catch { /* private mode — the default selection still works */ }
            const aspect = state.aspects.find(a => a.id === id);
            if (aspect) normalizeAspect(aspect);
            renderAspectList();
            applyAspectBackground();
            showChatView();
        }

        export function getCurrentAspect() {
            const aspect = state.aspects.find(a => a.id === state.currentAspectId);
            // Guarantee callers a conversation-bound chatHistory even for an
            // Aspect that arrived from an older save or a partial import.
            return aspect ? normalizeAspect(aspect) : aspect;
        }

        export function updateAspectData(field, value) {
            const aspect = getCurrentAspect();
            if (aspect) {
                aspect[field] = value;
                if (field === 'name' || field === 'icon') renderAspectList();
                markChangesUnsaved();
            }
        }

        /**
         * Mark an imported Aspect's tools as reviewed so they can run. Called
         * from the editor after the user has had the chance to read the code.
         */
        export function trustAspectTools() {
            const aspect = getCurrentAspect();
            if (!aspect) return;
            if (!window.confirm(
                `Enable ${aspect.tools.length} tool(s) on "${aspect.name}"?\n\n` +
                `These were imported from an .aspect file. They run JavaScript in a ` +
                `sandboxed iframe that can't see your data; network access stays off ` +
                `for each tool until you grant it. Only enable them if you have ` +
                `reviewed the code and trust its source.`
            )) return;
            trustAllTools(aspect);
            markChangesUnsaved();
            if (typeof window.showEditorView === 'function') window.showEditorView();
            if (typeof window.showToast === 'function') window.showToast('Tools enabled for this Aspect.');
        }

        export async function deleteCurrentAspect() {
            if (state.aspects.length <= 1) {
                window.showToast("You must keep at least one Aspect. Create a new one before deleting this one.", "error");
                return;
            }
            if (confirm("Are you sure you want to delete this Aspect? All history and tools will be lost.")) {
                const deletedAspectId = state.currentAspectId;
                const index = state.aspects.findIndex(a => a.id === deletedAspectId);
                state.aspects.splice(index, 1);
                state.currentAspectId = state.aspects[0].id;
                renderAspectList();
                showChatView();
                markChangesUnsaved();

                try {
                    await deleteAspectData(deletedAspectId);
                    await deleteAspectRecord(deletedAspectId);
                } catch (e) {
                    console.error("Failed to delete aspect data from DB", e);
                }
            }
        }

        export function renderAspectList() {
            const list = document.getElementById('aspect-list');
            list.innerHTML = '';
            state.aspects.forEach(aspect => {
                const item = document.createElement('div');
                item.className = 'aspect-item' + (aspect.id === state.currentAspectId ? ' active' : '');
                item.onclick = () => selectAspect(aspect.id);
                
                const iconSrc = aspect.icon || getGenericIcon();
                
                const img = document.createElement('img');
                img.src = iconSrc;
                img.className = 'aspect-icon-preview';
                item.appendChild(img);

                const span = document.createElement('span');
                span.className = 'aspect-name';
                span.textContent = aspect.name;
                item.appendChild(span);

                list.appendChild(item);
            });

            // Add the + button dynamically at the end of the aspect list
            const addBtn = document.createElement('button');
            addBtn.id = 'add-aspect-btn';
            addBtn.innerText = '+ New Aspect';
            addBtn.onclick = createNewAspect;
            list.appendChild(addBtn);
        }
