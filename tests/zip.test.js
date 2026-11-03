import { describe, it, expect, vi, beforeEach } from 'vitest';
import JSZip from 'jszip';
import { loadAspectFile, saveAspectToFile, exportAspectToWebpage, resolveImportedToolNames, MAX_ASPECT_FILE_SIZE } from '../src/js/modules/zip.js';
import { normalizeAspect, getCurrentAspect, renderAspectList } from '../src/js/modules/aspects.js';
import { markChangesSaved, flushAspects, state } from '../src/js/modules/state.js';
import { showChatView } from '../src/js/modules/ui.js';
import { commitImportedAspect, getKnowledgeFilesRaw } from '../src/js/modules/db.js';
import { saveBlob } from '../src/js/modules/download.js';
import { armPersistence, disarmPersistence } from '../src/js/modules/persist.js';

vi.mock('../src/js/modules/db.js', () => ({ commitImportedAspect: vi.fn(), getKnowledgeFilesRaw: vi.fn() }));
vi.mock('../src/js/modules/download.js', () => ({ saveBlob: vi.fn() }));
vi.mock('../src/js/modules/aspects.js', async original => ({ ...(await original()), getCurrentAspect: vi.fn(), renderAspectList: vi.fn() }));
vi.mock('../src/js/modules/state.js', () => ({ markChangesSaved: vi.fn(), flushAspects: vi.fn(), state: { aspects: [], currentAspectId: null, isGenerating: false, libraryBusy: false } }));
vi.mock('../src/js/modules/ui.js', () => ({ showChatView: vi.fn(), applyAspectBackground: vi.fn() }));

// Real JSZip fixtures replace the old async()-only mocks. These assertions
// exercise actual compression, bounded streaming, folder scoping and persistence.
async function importZip(files = {}, options = {}) {
    const zip = new JSZip();
    for (const [path, content] of Object.entries(files)) zip.file(path, content);
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', ...options });
    const event = { target: { files: [bytes], value: 'test.aspect' } };
    await loadAspectFile(event);
    expect(event.target.value).toBe('');
    return bytes;
}
const readBlob = blob => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
});

describe('ZIP imports and exports', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        armPersistence();
        window.showToast = vi.fn();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        state.aspects = [];
        state.currentAspectId = null;
        state.isGenerating = false;
        state.libraryBusy = false;
        commitImportedAspect.mockResolvedValue(undefined);
        flushAspects.mockResolvedValue(undefined);
        getKnowledgeFilesRaw.mockResolvedValue([]);
        saveBlob.mockResolvedValue(true);
    });

    it('rejects corrupt and compressed-upload-oversized files without changing state', async () => {
        const event = { target: { files: [new Uint8Array([0, 1, 2])], value: 'bad.aspect' } };
        await loadAspectFile(event);
        expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('Error loading .aspect file'), 'error');
        expect(event.target.value).toBe('');
        await loadAspectFile({ target: { files: [{ size: MAX_ASPECT_FILE_SIZE + 1 }], value: '' } });
        expect(window.showToast).toHaveBeenCalledWith('Aspect file exceeds the 50MB size limit.', 'error');
        expect(state.aspects).toEqual([]);
        expect(commitImportedAspect).not.toHaveBeenCalled();
        expect(state.libraryBusy).toBe(false);
    });

    it('imports metadata, binary images, Windows paths and scoped knowledge atomically', async () => {
        await importZip({
            'Name.md': 'Loaded Name', 'Description.md': 'Loaded Desc', 'Instructions.md': 'Loaded Instr',
            'Knowledge/KnowledgeFile.md': 'Loaded Knowledge', 'Knowledge\\Files\\nested\\notes.txt': 'win notes',
            'Knowledge/Files/doc1.txt': 'doc content', 'Icon.png': new Uint8Array([1, 2, 3]),
            'Background.png': new Uint8Array([4, 5, 6]), 'memory.json': '{"mem1":"val1","~secret":"session"}',
            'Tools\\nested\\custom_tool.js': 'console.log("win tool");',
            'Tools/state.json': '{"custom_tool.js":{"on":true}}',
            'Elsewhere/ignored.js': 'never a tool', 'ImagePack/notanimage.txt': 'not a background',
            'ChatHistory/History.md': '# History\n\n### User\nHello\n\n### Assistant\nHi'
        });
        const aspect = state.aspects[0];
        expect(aspect).toMatchObject({ name: 'Loaded Name', description: 'Loaded Desc', instructions: 'Loaded Instr', knowledge: 'Loaded Knowledge',
            icon: 'data:image/png;base64,AQID', background: 'data:image/png;base64,BAUG', memory: { mem1: 'val1' }, toolsReviewed: false });
        expect(aspect.chatHistory).toEqual([{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi' }]);
        expect(aspect.tools).toEqual([{ name: 'custom_tool.js', code: 'console.log("win tool");', state: { on: true } }]);
        expect(commitImportedAspect).toHaveBeenCalledWith(expect.objectContaining({ id: aspect.id, memory: { mem1: 'val1' } }),
            [{ name: 'doc1.txt', text: 'doc content' }, { name: 'notes.txt', text: 'win notes' }]);
        expect(flushAspects.mock.invocationCallOrder[0]).toBeLessThan(commitImportedAspect.mock.invocationCallOrder[0]);
        expect(state.currentAspectId).toBe(aspect.id);
        expect(renderAspectList).toHaveBeenCalled();
        expect(showChatView).toHaveBeenCalled();
        expect(markChangesSaved).toHaveBeenCalled();
        expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('left DISABLED'), 'error');
        expect(state.libraryBusy).toBe(false);
    });

    it('imports missing optional metadata, legacy b64 icons and malformed JSON safely', async () => {
        await importZip({ 'Description.md': 'Desc', 'Icon.b64': 'AQID', 'memory.json': 'broken', 'Tools/state.json': 'broken', 'Tools/tool.js': 'return 1;' });
        expect(state.aspects[0]).toMatchObject({ name: 'Imported Aspect', description: 'Desc', knowledge: '', background: '', icon: 'data:image/png;base64,AQID', memory: {} });
        expect(state.aspects[0].tools[0].state).toEqual({});
        expect(console.error).toHaveBeenCalledWith('Failed to parse tool state.json during aspect import', expect.any(String));
        expect(console.error).toHaveBeenCalledWith('Failed to parse memory.json during aspect import', expect.any(String));
    });

    it('rekeys imported conversations and excludes malformed records/messages', async () => {
        await importZip({ 'ChatHistory/conversations.json': JSON.stringify({ activeConversationId: 'old2', conversations: [null,
            { id: 'old1', title: 'One', messages: [{ role: 'system', content: 'bad' }, null] },
            { id: 'old2', title: 'Two', messages: [{ role: 'assistant', content: 'keep' }] }] }) });
        const aspect = state.aspects[0];
        expect(aspect.conversations).toHaveLength(2);
        expect(aspect.conversations.every(conv => !['old1', 'old2'].includes(conv.id))).toBe(true);
        expect(aspect.activeConversationId).toBe(aspect.conversations[1].id);
        expect(aspect.chatHistory).toEqual([{ role: 'assistant', content: 'keep' }]);
    });

    it('retains previous library and selection on atomic persistence failure', async () => {
        const previous = normalizeAspect({ id: 'original', name: 'Existing' });
        state.aspects = [previous];
        state.currentAspectId = previous.id;
        commitImportedAspect.mockRejectedValueOnce(new Error('Quota exceeded'));
        await importZip({ 'Name.md': 'New', 'Knowledge/Files/a.txt': 'a', 'Knowledge/Files/b.txt': 'b' });
        expect(state.aspects).toEqual([previous]);
        expect(state.currentAspectId).toBe('original');
        expect(markChangesSaved).not.toHaveBeenCalled();
        expect(showChatView).not.toHaveBeenCalled();
        expect(state.libraryBusy).toBe(false);
        expect(window.showToast).toHaveBeenCalledWith('Error loading .aspect file: Quota exceeded', 'error');
    });

    it('refuses imports into read-only recovery without bypassing persistence guards', async () => {
        disarmPersistence(new Error('Unreadable library'));
        await importZip({ 'Name.md': 'New' });
        expect(commitImportedAspect).not.toHaveBeenCalled();
        expect(state.aspects).toEqual([]);
        expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('read-only'), 'error');
    });

    it('bounds export filenames for long and non-Latin Aspect names', async () => {
        getCurrentAspect.mockReturnValue(normalizeAspect({ name: '人物'.repeat(200) }));
        await saveAspectToFile();
        expect(saveBlob.mock.calls[0][1].length).toBeLessThanOrEqual(180);
        expect(saveBlob.mock.calls[0][1]).toMatch(/\.aspect$/);
    });

    it('reports a presentation failure separately after a successful durable import', async () => {
        renderAspectList.mockImplementationOnce(() => { throw new Error('View refresh failed'); });
        await importZip({ 'Name.md': 'Saved' });
        expect(commitImportedAspect).toHaveBeenCalledTimes(1);
        expect(state.aspects[0].name).toBe('Saved');
        expect(state.currentAspectId).toBe(state.aspects[0].id);
        expect(window.showToast).toHaveBeenCalledWith('The imported Aspect was saved, but the view could not refresh. Reload to display it.', 'error');
        expect(state.libraryBusy).toBe(false);
    });

    it('aborts before transaction when flushing pending writes fails', async () => {
        flushAspects.mockRejectedValueOnce(new Error('Read-only storage'));
        await importZip({ 'Name.md': 'New' });
        expect(commitImportedAspect).not.toHaveBeenCalled();
        expect(state.aspects).toEqual([]);
    });

    it('refuses imports during generation or another library operation', async () => {
        state.isGenerating = true;
        await importZip({ 'Name.md': 'New' });
        state.isGenerating = false;
        state.libraryBusy = true;
        await importZip({ 'Name.md': 'New' });
        expect(commitImportedAspect).not.toHaveBeenCalled();
        expect(state.aspects).toEqual([]);
        expect(state.libraryBusy).toBe(true);
    });

    it('takes the library operation lock before asynchronous reads and rejects concurrent import', async () => {
        let finish;
        flushAspects.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const zip = new JSZip().file('Name.md', 'New');
        const file = await zip.generateAsync({ type: 'uint8array' });
        const first = loadAspectFile({ target: { files: [file] } });
        expect(state.libraryBusy).toBe(true);
        await loadAspectFile({ target: { files: [file] } });
        await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
        finish();
        await first;
        expect(state.aspects).toHaveLength(1);
        expect(commitImportedAspect).toHaveBeenCalledTimes(1);
        expect(state.libraryBusy).toBe(false);
    });

    it('rejects duplicate flattened knowledge names before transaction', async () => {
        await importZip({ 'Knowledge/Files/a/notes.txt': 'one', 'Knowledge/Files/b/notes.txt': 'two' });
        expect(commitImportedAspect).not.toHaveBeenCalled();
        expect(state.aspects).toEqual([]);
        expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('duplicate filenames'), 'error');
    });

    it('resolves reserved and duplicate tool names without trusting imported code', () => {
        const tools = resolveImportedToolNames([{ name: 'Calculator.js' }, { name: 'nested.js' }, { name: 'NESTED.js' }]);
        expect(tools.map(t => t.name.toLowerCase())).toEqual(['imported_calculator.js', 'nested.js', 'nested_2.js']);
    });

    it('exports complete portable archives with durable memory and raw knowledge', async () => {
        const aspect = normalizeAspect({ id: 'one', name: 'Test Aspect!', description: 'Desc', instructions: 'Inst', knowledge: 'Knowledge',
            icon: 'data:image/png;base64,AQID', background: 'data:image/jpeg;base64,BAUG', memory: { saved: 'keep', '~secret': 'omit' },
            tools: [{ name: 'Tool.js', code: 'return 1;', state: { val: 1 } }], chatHistory: [{ role: 'user', content: 'hi' }] });
        getCurrentAspect.mockReturnValue(aspect);
        getKnowledgeFilesRaw.mockResolvedValueOnce([{ name: 'file.txt', text: 'Knowledge 1' }]);
        await saveAspectToFile();
        expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'Test_Aspect_.aspect', 'application/zip');
        const zip = await JSZip.loadAsync(await readBlob(saveBlob.mock.calls[0][0]));
        expect(await zip.file('Name.md').async('string')).toBe('Test Aspect!');
        expect(await zip.file('Description.md').async('string')).toBe('Desc');
        expect(await zip.file('Instructions.md').async('string')).toBe('Inst');
        expect(await zip.file('Knowledge/KnowledgeFile.md').async('string')).toBe('Knowledge');
        expect(await zip.file('Knowledge/Files/file.txt').async('string')).toBe('Knowledge 1');
        expect(await zip.file('Tools/Tool.js').async('string')).toBe('return 1;');
        expect(JSON.parse(await zip.file('Tools/state.json').async('string'))).toEqual({ 'Tool.js': { val: 1 } });
        expect(JSON.parse(await zip.file('memory.json').async('string'))).toEqual({ saved: 'keep' });
        expect(await zip.file('Icon.png').async('base64')).toBe('AQID');
        expect(await zip.file('Background.jpeg').async('base64')).toBe('BAUG');
        expect(await zip.file('ChatHistory/History.md').async('string')).toBe('### User\nhi\n\n');
        expect(JSON.parse(await zip.file('ChatHistory/conversations.json').async('string')).conversations[0].messages).toEqual([{ role: 'user', content: 'hi' }]);
        expect(markChangesSaved).toHaveBeenCalled();
    });

    it('exports a local preset background with no tools or memory', async () => {
        const source = normalizeAspect({ name: 'Preset', background: 'alone_image_pack/preset.png' });
        getCurrentAspect.mockReturnValue(source);
        const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true, blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }) });
        try {
            await saveAspectToFile();
            const zip = await JSZip.loadAsync(await readBlob(saveBlob.mock.calls[0][0]));
            expect(await zip.file('Background.png').async('base64')).toBe('AQID');
            expect(JSON.parse(await zip.file('memory.json').async('string'))).toEqual({});
            expect(zip.filter(path => path.startsWith('Tools/') && path.endsWith('.js'))).toEqual([]);
            expect(markChangesSaved).toHaveBeenCalled();
        } finally { fetch.mockRestore(); }
    });

    it('does not mark cancelled or failed exports saved', async () => {
        getCurrentAspect.mockReturnValue(normalizeAspect({ name: 'Test' }));
        saveBlob.mockResolvedValueOnce(false);
        await saveAspectToFile();
        saveBlob.mockRejectedValueOnce(new Error('Provider offline'));
        await saveAspectToFile();
        expect(markChangesSaved).not.toHaveBeenCalled();
        expect(window.showToast).toHaveBeenCalledWith('Could not export Aspect: Provider offline', 'error');
    });

    it('exports escaped HTML and reports success only after save completion', async () => {
        getCurrentAspect.mockReturnValue({ name: 'Web Aspect', description: '<script>alert(1)</script>', instructions: 'Instr <test>', icon: '' });
        await exportAspectToWebpage();
        const [blob, name, type] = saveBlob.mock.calls[0];
        const html = new TextDecoder().decode(await readBlob(blob));
        expect(name).toBe('Web_Aspect_card.html');
        expect(type).toBe('text/html');
        expect(html).toContain('&lt;script&gt;');
        expect(html).toContain('Instr &lt;test&gt;');
        expect(html).not.toContain('<img class="icon"');
        expect(window.showToast).toHaveBeenCalledWith('Webpage Exported Successfully!', 'success');
        window.showToast.mockClear();
        saveBlob.mockResolvedValueOnce(false);
        await exportAspectToWebpage();
        expect(window.showToast).not.toHaveBeenCalled();
        saveBlob.mockRejectedValueOnce(new Error('Write failed'));
        await exportAspectToWebpage();
        expect(window.showToast).toHaveBeenCalledWith('Could not export webpage: Write failed', 'error');
    });
});
