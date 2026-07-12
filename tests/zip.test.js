import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadAspectFile, saveAspectToFile, exportAspectToWebpage } from '../src/js/modules/zip.js';
import JSZip from 'jszip';
import { getCurrentAspect, renderAspectList } from '../src/js/modules/aspects.js';
import { markChangesSaved, state } from '../src/js/modules/state.js';
import { showChatView } from '../src/js/modules/ui.js';
import { saveKnowledgeFile } from '../src/js/modules/db.js';

vi.mock('jszip', () => {
    const mockJSZip = vi.fn(function() {
        this.file = vi.fn();
        this.folder = vi.fn(() => ({ file: vi.fn(), files: {} }));
        this.generateAsync = vi.fn().mockResolvedValue(new Blob(['dummy zip'], { type: 'application/zip' }));
    });
    mockJSZip.loadAsync = vi.fn();
    return { default: mockJSZip };
});

vi.mock('../src/js/modules/aspects.js', () => ({
    getCurrentAspect: vi.fn(),
    renderAspectList: vi.fn()
}));

vi.mock('../src/js/modules/state.js', () => ({
    markChangesSaved: vi.fn(),
    state: {
        aspects: [],
        currentAspectId: null
    }
}));

vi.mock('../src/js/modules/ui.js', () => ({
    showChatView: vi.fn()
}));

vi.mock('../src/js/modules/db.js', () => ({
    saveKnowledgeFile: vi.fn(),
    getKnowledgeFilesRaw: vi.fn()
}));

describe('Zip Module', () => {
    beforeEach(() => {
        window.showToast = vi.fn();
        console.error = vi.fn();

        // Mock DOM globals
        global.URL.createObjectURL = vi.fn(() => 'mock-url');
        global.URL.revokeObjectURL = vi.fn();
        global.Blob = class { constructor(content, options) { this.content = content; this.options = options; } };

        // Mock anchor element
        const mockAnchor = {
            href: '',
            download: '',
            click: vi.fn()
        };
        const originalCreateElement = document.createElement.bind(document);
        vi.spyOn(document, 'createElement').mockImplementation((tagName) => {
            if (tagName === 'a') return mockAnchor;
            return originalCreateElement(tagName);
        });

        // Reset state
        state.aspects = [];
        state.currentAspectId = null;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('handles bad zip format when loading aspect file', async () => {
        const mockError = new Error('Corrupted zip');
        JSZip.loadAsync.mockRejectedValue(mockError);

        const mockFile = new File([''], 'bad.aspect');
        const event = {
            target: {
                files: [mockFile],
                value: 'some/path.aspect'
            }
        };

        await loadAspectFile(event);

        expect(JSZip.loadAsync).toHaveBeenCalledWith(mockFile);
        expect(console.error).toHaveBeenCalledWith('Error loading .aspect file', mockError);
        expect(window.showToast).toHaveBeenCalledWith(`Error loading .aspect file: ${mockError.message}`, 'error');
        expect(event.target.value).toBe('');
    });

    it('saves aspect to file successfully', async () => {
        const mockAspect = {
            name: 'Test Aspect!',
            description: 'Test Desc',
            instructions: 'Test Instr',
            knowledge: 'Test Knowledge',
            icon: 'data:image/png;base64,iVBORw0KGgo=',
            background: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
            chatHistory: [],
            tools: []
        };
        getCurrentAspect.mockReturnValue(mockAspect);

        const mockZipFile = vi.fn();
        const mockGenerateAsync = vi.fn().mockResolvedValue(new Blob(['mock-blob-data']));

        JSZip.mockImplementationOnce(function() {
            this.file = mockZipFile;
            this.folder = vi.fn(() => ({ file: mockZipFile, files: {} }));
            this.generateAsync = mockGenerateAsync;
        });

        await saveAspectToFile();

        expect(mockZipFile).toHaveBeenCalledWith('Name.md', mockAspect.name);
        expect(mockZipFile).toHaveBeenCalledWith('Description.md', mockAspect.description);
        expect(mockZipFile).toHaveBeenCalledWith('Instructions.md', mockAspect.instructions);
        expect(mockZipFile).toHaveBeenCalledWith('Knowledge/KnowledgeFile.md', mockAspect.knowledge);
        expect(mockZipFile).toHaveBeenCalledWith('Icon.png', 'iVBORw0KGgo=', { base64: true });
        expect(mockZipFile).toHaveBeenCalledWith('Background.jpeg', '/9j/4AAQSkZJRg==', { base64: true });
        expect(mockGenerateAsync).toHaveBeenCalledWith({ type: 'blob' });
        expect(global.URL.createObjectURL).toHaveBeenCalled();
        expect(markChangesSaved).toHaveBeenCalled();
    });

    it('loads aspect file successfully', async () => {
        const mockZip = {
            file: vi.fn((path) => {
                const files = {
                    'Name.md': { async: vi.fn().mockResolvedValue('Loaded Name') },
                    'Description.md': { async: vi.fn().mockResolvedValue('Loaded Desc') },
                    'Instructions.md': { async: vi.fn().mockResolvedValue('Loaded Instr') },
                    'Knowledge/KnowledgeFile.md': { async: vi.fn().mockResolvedValue('Loaded Knowledge') },
                    'Icon.png': { async: vi.fn().mockResolvedValue('iVBORw0KGgo=') },
                    'Background.jpeg': { async: vi.fn().mockResolvedValue('/9j/4AAQSkZJRg==') },
                    'memory.json': { async: vi.fn().mockResolvedValue('{"mem1":"val1"}') },
                    'ChatHistory/History.md': { async: vi.fn().mockResolvedValue('# History\n\n### User\nHello\n\n### Assistant\nHi') }
                };
                return files[path];
            }),
            folder: vi.fn((path) => {
                if (path === 'Tools') {
                    return {
                        file: vi.fn((name) => {
                            if (name === 'state.json') {
                                return { async: vi.fn().mockResolvedValue('{"tool1.js":{"on":true}}') };
                            }
                            return null;
                        }),
                        files: {
                            'Tools/tool1.js': { dir: false, async: vi.fn().mockResolvedValue('console.log("tool1");') },
                            'Tools/subdir': { dir: true }
                        }
                    };
                }
                if (path === 'Knowledge/Files') {
                    return {
                        files: {
                            'Knowledge/Files/doc1.txt': { dir: false, async: vi.fn().mockResolvedValue('doc content') }
                        }
                    };
                }
                return null;
            })
        };

        JSZip.loadAsync.mockResolvedValue(mockZip);

        const mockFile = new File(['dummy content'], 'test.aspect');
        const event = {
            target: {
                files: [mockFile],
                value: 'some/path.aspect'
            }
        };

        await loadAspectFile(event);

        expect(JSZip.loadAsync).toHaveBeenCalledWith(mockFile);

        expect(state.aspects.length).toBe(1);
        const loadedAspect = state.aspects[0];
        expect(loadedAspect.name).toBe('Loaded Name');
        expect(loadedAspect.description).toBe('Loaded Desc');
        expect(loadedAspect.instructions).toBe('Loaded Instr');
        expect(loadedAspect.knowledge).toBe('Loaded Knowledge');
        expect(loadedAspect.icon).toBe('data:image/png;base64,iVBORw0KGgo=');
        expect(loadedAspect.background).toBe('data:image/jpeg;base64,/9j/4AAQSkZJRg==');
        expect(loadedAspect.memory).toEqual({ mem1: 'val1' });
        expect(loadedAspect.chatHistory).toEqual([
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi' }
        ]);
        expect(loadedAspect.tools).toEqual([
            { name: 'tool1.js', code: 'console.log("tool1");', state: { on: true } }
        ]);

        expect(saveKnowledgeFile).toHaveBeenCalledWith(loadedAspect.id, 'doc1.txt', 'doc content');
        expect(renderAspectList).toHaveBeenCalled();
        expect(showChatView).toHaveBeenCalled();
        expect(markChangesSaved).toHaveBeenCalled();
        expect(event.target.value).toBe('');
    });

    it('exports aspect to webpage successfully', async () => {
        const mockAspect = {
            name: 'Web Aspect',
            description: 'Web Desc',
            instructions: 'Web Instr <test>',
            icon: 'data:image/png;base64,abc'
        };
        getCurrentAspect.mockReturnValue(mockAspect);

        await exportAspectToWebpage();

        expect(global.URL.createObjectURL).toHaveBeenCalled();
        expect(window.showToast).toHaveBeenCalledWith("Webpage Exported Successfully!", "success");

        // Verify anchor element operations via DOM mock
        const mockAnchor = document.createElement('a'); // returns the mock from beforeEach
        expect(mockAnchor.href).toBe('mock-url');
        expect(mockAnchor.download).toBe('Web_Aspect_card.html');
        expect(mockAnchor.click).toHaveBeenCalled();
        expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('mock-url');
    });
});
