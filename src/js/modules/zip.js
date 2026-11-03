import { showChatView, applyAspectBackground } from './ui.js';
import { renderAspectList, getCurrentAspect, normalizeAspect, sanitizeToolName, RESERVED_TOOL_NAMES } from './aspects.js';
import { markChangesSaved, flushAspects, state } from './state.js';
import { getKnowledgeFilesRaw, commitImportedAspect } from './db.js';
import { saveBlob } from './download.js';
import { readBoundedArchive } from './archive.js';
import { addDataImage, addPresetBackground, readArchiveImage } from './archiveImages.js';
import { serializeAspect, isPersistReady } from './persist.js';
import { durableMemory } from './memory.js';
import { newId } from './conversations.js';

export const MAX_ASPECT_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

function exportStem(name) {
    return (String(name || 'Aspect').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 160) || 'Aspect');
}

/**
 * Make imported tool filenames safe and non-deceptive: sanitised charset, no
 * collision with a built-in system tool (an unreviewed `Calculator.js` must not
 * masquerade as the trusted one), and no duplicates within the Aspect.
 */
export function resolveImportedToolNames(tools) {
    const reserved = new Set(RESERVED_TOOL_NAMES.map(n => n.toLowerCase()));
    const seen = new Set();
    tools.forEach(t => {
        let base = sanitizeToolName(t.name);
        if (reserved.has(base.toLowerCase())) base = 'imported_' + base;
        let name = base;
        let i = 2;
        while (seen.has(name.toLowerCase())) {
            name = base.replace(/\.js$/i, '') + '_' + (i++) + '.js';
        }
        seen.add(name.toLowerCase());
        t.name = name;
    });
    return tools;
}

// JSZip (~95 KB) is only needed for .aspect import/export. Load it on demand.
let jszipPromise = null;
function loadJSZip() {
    if (!jszipPromise) {
        jszipPromise = import('jszip').then(m => m.default || m);
    }
    return jszipPromise;
}

export async function saveAspectToFile() {
    const aspect = getCurrentAspect();
    if (!aspect) return;

    try {
        const JSZip = await loadJSZip();
        const zip = new JSZip();

        zip.file("Name.md", aspect.name);
        zip.file("Description.md", aspect.description);
        zip.file("Instructions.md", aspect.instructions);
        zip.file("Knowledge/KnowledgeFile.md", aspect.knowledge || "");

        if (aspect.icon) addDataImage(zip, 'Icon', aspect.icon);
        if (aspect.background) {
            if (aspect.background.startsWith('data:')) addDataImage(zip, 'Background', aspect.background);
            else await addPresetBackground(zip, aspect.background);
        }

        const toolsFolder = zip.folder("Tools");
        if (aspect.tools) {
            const toolsState = {};
            aspect.tools.forEach(tool => {
                toolsFolder.file(tool.name, tool.code);
                if (tool.state) toolsState[tool.name] = tool.state;
            });
            if (Object.keys(toolsState).length > 0) {
                toolsFolder.file("state.json", JSON.stringify(toolsState, null, 2));
            }
        }

        // Chat history is written twice, on purpose:
        //
        //  - conversations.json is the lossless record. It round-trips every
        //    conversation with its title, timestamps and exact message text.
        //  - ChatHistory/History.md is the human-readable transcript of the
        //    active conversation, and is what older builds of Aspect Studio
        //    (and the documented .aspect layout) know how to read.
        //
        // Import prefers the JSON and falls back to the Markdown, so files
        // move in both directions without losing anything.
        const conversations = (aspect.conversations || []).map(conv => ({
            id: conv.id,
            title: conv.title,
            titleLocked: !!conv.titleLocked,
            createdAt: conv.createdAt,
            updatedAt: conv.updatedAt,
            messages: (conv.messages || [])
                .filter(m => m.role === 'user' || m.role === 'assistant')
                .map(m => ({ role: m.role, content: m.content }))
        }));
        zip.file("ChatHistory/conversations.json", JSON.stringify({
            version: 2,
            activeConversationId: aspect.activeConversationId,
            conversations
        }, null, 2));

        let historyMd = "";
        aspect.chatHistory.forEach(msg => {
            if (msg.role === 'user' || msg.role === 'assistant') {
                historyMd += `### ${msg.role === 'user' ? 'User' : aspect.name}\n${msg.content}\n\n`;
            }
        });
        zip.file("ChatHistory/History.md", historyMd);

        // Generation settings and editor mode travel with the Aspect so an
        // imported one behaves exactly as it did for its author.
        zip.file("config.json", JSON.stringify({
            params: aspect.params || {},
            basicMode: aspect.basicMode,
            basicDescription: aspect.basicDescription,
            basicTone: aspect.basicTone
        }, null, 2));

        // Export raw knowledge files from IndexedDB
        const rawKnowledgeFiles = await getKnowledgeFilesRaw(aspect.id);
        zip.file("memory.json", JSON.stringify(durableMemory(aspect.memory), null, 2));

        if (rawKnowledgeFiles && rawKnowledgeFiles.length > 0) {
            const knowledgeFolder = zip.folder("Knowledge/Files");
            rawKnowledgeFiles.forEach(f => {
                knowledgeFolder.file(f.name, f.text);
            });
        }

        const blob = await zip.generateAsync({type: "blob"});
        if (await saveBlob(blob, `${exportStem(aspect.name)}.aspect`, 'application/zip')) {
            markChangesSaved();
        }
    } catch (error) {
        window.showToast(`Could not export Aspect: ${error.message}`, 'error');
    }
}

export async function loadAspectFile(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;
    if (state.isGenerating || state.libraryBusy) {
        window.showToast('Stop generation or wait for the current library operation before importing.', 'error');
        if (event.target) event.target.value = '';
        return;
    }
    state.libraryBusy = true;
    let committed = false;
    try {
        if (!isPersistReady()) throw new Error('Storage recovery is read-only. Reload before importing.');
        if (Number.isFinite(file.size) && file.size > MAX_ASPECT_FILE_SIZE) {
            window.showToast('Aspect file exceeds the 50MB size limit.', 'error');
            return;
        }
        const JSZip = await loadJSZip();
        const archive = await readBoundedArchive(await JSZip.loadAsync(file));
        const name = archive.text('Name.md')?.trim() || 'Imported Aspect';
        const desc = archive.text('Description.md')?.trim() || '';
        const instr = archive.text('Instructions.md')?.trim() || '';
        const knowledge = archive.text('Knowledge/KnowledgeFile.md') || '';
        const icon = readArchiveImage(archive, 'Icon');
        const background = readArchiveImage(archive, 'Background');
        const json = (path, fallback, label) => {
            if (!archive.has(path)) return fallback;
            try { return JSON.parse(archive.text(path)); }
            catch (error) {
                console.error(`Failed to parse ${label} during aspect import`, error.message);
                return fallback;
            }
        };
        const toolsState = json('Tools/state.json', {}, 'tool state.json') || {};
        const tools = archive.paths.filter(path => path.startsWith('Tools/') && path.endsWith('.js')).map(path => {
            const toolName = path.split('/').pop();
            return { name: toolName, code: archive.text(path), state: Object.hasOwn(toolsState, toolName) ? toolsState[toolName] : {} };
        });
        resolveImportedToolNames(tools);
        const memory = durableMemory(json('memory.json', {}, 'memory.json'));
        const parsed = json('ChatHistory/conversations.json', null, 'conversations.json');
        let conversations = null;
        let activeConversationId = null;
        if (Array.isArray(parsed?.conversations) && parsed.conversations.length > 0) {
            conversations = parsed.conversations.filter(conv => conv && typeof conv === 'object').map(conv => ({
                id: newId('conv'), originalId: conv.id,
                title: typeof conv.title === 'string' ? conv.title : 'Imported chat',
                titleLocked: !!conv.titleLocked,
                createdAt: Number.isFinite(conv.createdAt) ? conv.createdAt : Date.now(),
                updatedAt: Number.isFinite(conv.updatedAt) ? conv.updatedAt : Date.now(),
                messages: Array.isArray(conv.messages) ? conv.messages
                    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
                    .map(m => ({ role: m.role, content: m.content })) : []
            }));
            if (conversations.length) {
                activeConversationId = (conversations.find(c => c.originalId === parsed.activeConversationId) || conversations[0]).id;
                conversations.forEach(c => { delete c.originalId; });
            } else conversations = null;
        }
        const chatHistory = [];
        if (!conversations && archive.has('ChatHistory/History.md')) {
            for (const block of archive.text('ChatHistory/History.md').split('### ').slice(1)) {
                const lines = block.split('\n');
                const header = lines[0].trim();
                const content = lines.slice(1).join('\n').trim();
                if (content) chatHistory.push({ role: header === 'User' ? 'user' : 'assistant', content });
            }
        }
        const config = json('config.json', {}, 'config.json') || {};
        const newAspect = normalizeAspect({
            id: newId('aspect'), name, description: desc, instructions: instr, knowledge,
            icon, background, tools, toolsReviewed: tools.length === 0, memory,
            params: config.params || {}, basicMode: config.basicMode,
            basicDescription: config.basicDescription, basicTone: config.basicTone,
            ...(conversations ? { conversations, activeConversationId } : { chatHistory })
        });
        const knowledgeFiles = [];
        const names = new Set();
        for (const path of archive.paths.filter(path => path.startsWith('Knowledge/Files/'))) {
            const fileName = path.split('/').pop();
            if (names.has(fileName)) throw new Error('Knowledge files contain duplicate filenames.');
            names.add(fileName);
            knowledgeFiles.push({ name: fileName, text: archive.text(path) });
        }
        // A pending whole-library save must commit first, or it could
        // delete the newly imported row using the older in-memory list.
        await flushAspects();
        if (state.isGenerating) throw new Error('Stop generation before importing an Aspect.');
        if (!isPersistReady()) throw new Error('Storage recovery is read-only. Reload before importing.');
        await commitImportedAspect(serializeAspect(newAspect), knowledgeFiles);
        committed = true;
        state.aspects.push(newAspect);
        // Generation may begin while the transaction commits. Publish
        // the imported library row without changing its active context.
        if (!state.isGenerating) {
            state.currentAspectId = newAspect.id;
            try { localStorage.setItem('currentAspectId', newAspect.id); } catch { /* Storage blocked/full. */ }
            applyAspectBackground();
            showChatView();
        }
        renderAspectList();
        markChangesSaved();
        if (newAspect.toolsReviewed === false) {
            window.showToast(`Imported "${name}" with ${tools.length} tool(s) left DISABLED. Open the editor, review the tool code, then enable them.`, 'error');
        }
    } catch (err) {
        console.error(committed ? 'Imported Aspect saved but view refresh failed' : 'Error loading .aspect file', err);
        window.showToast(committed
            ? 'The imported Aspect was saved, but the view could not refresh. Reload to display it.'
            : `Error loading .aspect file: ${err.message}`, 'error');
    } finally {
        state.libraryBusy = false;
        if (event.target) event.target.value = '';
    }
}

// Full HTML-entity escape, safe for both text and double-quoted
// attribute contexts.
function esc(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Only allow an icon the exported page can safely render as an image.
function safeIconSrc(icon) {
    if (typeof icon !== 'string') return '';
    return /^data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=\s]+$/i.test(icon) ? icon : '';
}

export async function exportAspectToWebpage() {
    const aspect = getCurrentAspect();
    if (!aspect) return;

    const safeName = esc(aspect.name);
    const safeDesc = esc(aspect.description);
    const safeInstructions = esc(aspect.instructions);
    const safeIcon = esc(safeIconSrc(aspect.icon));
    const iconHtml = safeIcon ? `<img class="icon" src="${safeIcon}" alt="Aspect Icon">\n        ` : '';

    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
    <title>${safeName} - Aspect Card</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: #f5ece1;
            color: #3d2f26;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            padding: 20px;
        }
        .card {
            background: #fff;
            border-radius: 16px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            max-width: 600px;
            width: 100%;
            padding: 40px;
            text-align: center;
        }
        .icon {
            width: 120px;
            height: 120px;
            border-radius: 50%;
            object-fit: cover;
            border: 4px solid #597d53;
            margin-bottom: 20px;
        }
        h1 { margin: 0 0 10px 0; color: #cc6d4e; }
        p.desc { font-size: 1.2rem; color: #7c685b; margin-bottom: 30px; }
        .details { text-align: left; background: #f9f9f9; padding: 20px; border-radius: 8px; font-size: 0.95rem; line-height: 1.5; white-space: pre-wrap; }
        .badge { display: inline-block; background: #597d53; color: white; padding: 5px 12px; border-radius: 20px; font-size: 0.8rem; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="card">
        ${iconHtml}<h1>${safeName}</h1>
        <p class="desc">${safeDesc}</p>
        <div class="details">
            <strong>System Prompt / Instructions:</strong><br><br>
            ${safeInstructions}
        </div>
        <div class="badge">Created with Aspect Studio</div>
    </div>
</body>
</html>`;

    const blob = new Blob([htmlContent], { type: 'text/html' });
    try {
        if (await saveBlob(blob, `${exportStem(aspect.name)}_card.html`, 'text/html')) {
            window.showToast('Webpage Exported Successfully!', 'success');
        }
    } catch (error) {
        window.showToast(`Could not export webpage: ${error.message}`, 'error');
    }
}
