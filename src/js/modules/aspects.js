import { applyAspectBackground } from './ui.js';
import { showChatView } from './ui.js';
import { saveAspectsToLocalStorage } from './state.js';
import { showEditorView } from './ui.js';
import { markChangesUnsaved } from './ui.js';
import { state } from './state.js';


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

        export function loadDefaultAspects() {
            const saved = localStorage.getItem('aspects_data');
            if (saved) {
                try {
                    state.aspects = JSON.parse(saved);
                    if (state.aspects.length > 0) {
                        state.currentAspectId = state.aspects[0].id;
                        renderAspectList();
                        applyAspectBackground();
                        showChatView();
                        return;
                    }
                } catch (e) {
                    console.error("Failed to load saved aspects from localStorage", e);
                }
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
                        code: `// Calculator tool for basic math\n// Usage: executeTool({ expression: "2 + 2" })\nfunction executeTool(args) {\n    const expr = args.expression || args;\n    if (!expr) return "No expression provided.";\n    try {\n        if (/^[0-9+\\-*/().\\s]+$/.test(expr)) {\n            const res = new Function("return " + expr)();\n            return { result: res };\n        }\n        return { error: "Invalid math expression characters." };\n    } catch (e) {\n        return { error: e.message };\n    }\n}`
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

            state.aspects = [defaultAspect];
            state.currentAspectId = defaultAspect.id;
            saveAspectsToLocalStorage();
            renderAspectList();
            showChatView();
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
                tools: []
            },
            {
                id: 'python-mentor',
                name: 'The Python Mentor',
                desc: 'A patient teacher who explains Python concepts simply.',
                instructions: `You are a Python programming mentor.\n\nCORE DIRECTIVE:\nHelp the user learn Python. Explain concepts simply and provide code examples. Do not write the entire code for them; guide them to the answer.\n\nTONE:\nYour communication style should be Casual.`,
                knowledge: `# Python Best Practices\n- Use snake_case for variables and functions.\n- Keep code DRY (Don't Repeat Yourself).\n- Use list comprehensions when appropriate.`,
                tools: []
            },
            {
                id: 'plot-architect',
                name: 'Creative Plot Architect',
                desc: 'A brainstorming partner for novelists and writers.',
                instructions: `You are a Creative Plot Architect.\n\nCORE DIRECTIVE:\nHelp the user brainstorm story ideas, plot twists, and character arcs. Ask probing questions to develop their narrative.\n\nTONE:\nYour communication style should be Very Casual & Friendly.`,
                knowledge: `# Story Structure\n- Setup, Inciting Incident, Rising Action, Climax, Falling Action, Resolution.\n- Focus on character growth and conflict.`,
                tools: []
            },
            {
                id: 'data-analyst',
                name: 'The Data Analyst',
                desc: 'A strict analytical assistant with a built-in calculator.',
                instructions: `You are a Data Analyst.\n\nCORE DIRECTIVE:\nHelp the user analyze data and perform calculations. Always double check your math using the Calculator tool.\n\nTONE:\nYour communication style should be Professional.`,
                knowledge: '',
                tools: ['Calculator.js']
            }
        ];

        export function createNewAspect() {
            document.getElementById('create-aspect-modal').classList.remove('hidden');

            const gallery = document.getElementById('template-gallery');
            gallery.innerHTML = '';

            aspectTemplates.forEach(template => {
                const card = document.createElement('div');
                card.className = 'template-card';
                card.innerHTML = `
                    <h3>${template.name}</h3>
                    <p>${template.desc}</p>
                `;
                card.onclick = () => acceptCreateAspect(template.id);
                gallery.appendChild(card);
            });
        }

        export function acceptCreateAspect(templateId) {
            import('./systemTools.js').then(module => {
                const systemTools = module.systemTools;
                const template = aspectTemplates.find(t => t.id === templateId) || aspectTemplates[0];

                const initialTools = [];
                if (template.tools) {
                    template.tools.forEach(toolName => {
                        const sysTool = systemTools.find(st => st.name === toolName);
                        if (sysTool) {
                            initialTools.push({ name: sysTool.name, code: sysTool.code, state: {} });
                        }
                    });
                }

                const newAspect = {
                    id: Date.now().toString(),
                    name: template.name === 'Blank Aspect' ? 'New Aspect' : template.name,
                    description: template.desc,
                    instructions: template.instructions,
                    knowledge: template.knowledge,
                    icon: getGenericIcon(),
                    background: 'alone_image_pack/lake_sunset_002.jpeg',
                    tools: initialTools,
                    chatHistory: []
                };

                state.aspects.push(newAspect);
                state.currentAspectId = newAspect.id;
                renderAspectList();
                showEditorView();
                markChangesUnsaved();
                document.getElementById('create-aspect-modal').classList.add('hidden');
            });
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
            const name = document.getElementById('create-aspect-name-input').value.trim() || 'New Aspect';
            const desc = document.getElementById('create-aspect-desc-input').value.trim() || 'A brand new persona.';
            const icon = window.tempCreateIcon || getGenericIcon();

            const newAspect = {
                id: Date.now().toString(),
                name: name,
                description: desc,
                instructions: 'You are a helpful assistant.',
                knowledge: '',
                icon: icon,
                background: 'alone_image_pack/lake_sunset_002.jpeg',
                tools: [],
                memory: {},
                chatHistory: []
            };
            state.aspects.push(newAspect);
            state.currentAspectId = newAspect.id;
            renderAspectList();
            showEditorView();
            markChangesUnsaved();
            document.getElementById('create-aspect-modal').classList.add('hidden');
        }
        
        export function cancelCreateAspect() {
            document.getElementById('create-aspect-modal').classList.add('hidden');
        }

        export function selectAspect(id) {
            state.currentAspectId = id;
            renderAspectList();
            applyAspectBackground();
            showChatView();
        }

        export function getCurrentAspect() {
            return state.aspects.find(a => a.id === state.currentAspectId);
        }

        export function updateAspectData(field, value) {
            const aspect = getCurrentAspect();
            if (aspect) {
                aspect[field] = value;
                if (field === 'name' || field === 'icon') renderAspectList();
                markChangesUnsaved();
            }
        }

        export function deleteCurrentAspect() {
            if (state.aspects.length <= 1) {
                window.showToast("You must keep at least one Aspect. Create a new one before deleting this one.", "error");
                return;
            }
            if (confirm("Are you sure you want to delete this Aspect? All history and tools will be lost.")) {
                const index = state.aspects.findIndex(a => a.id === state.currentAspectId);
                state.aspects.splice(index, 1);
                state.currentAspectId = state.aspects[0].id;
                renderAspectList();
                showChatView();
                markChangesUnsaved();
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
                
                item.innerHTML = `
                    <img src="${iconSrc}" class="aspect-icon-preview">
                    <span class="aspect-name">${aspect.name}</span>
                `;
                list.appendChild(item);
            });

            // Add the + button dynamically at the end of the aspect list
            const addBtn = document.createElement('button');
            addBtn.id = 'add-aspect-btn';
            addBtn.innerText = '+ New Aspect';
            addBtn.onclick = createNewAspect;
            list.appendChild(addBtn);
        }
