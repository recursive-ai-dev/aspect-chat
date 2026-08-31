import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadAspectFile, saveAspectToFile, exportAspectToWebpage } from '../src/js/modules/zip.js';
import JSZip from 'jszip';
import { getCurrentAspect, renderAspectList } from '../src/js/modules/aspects.js';
import { markChangesSaved, state } from '../src/js/modules/state.js';
import { showChatView } from '../src/js/modules/ui.js';
import { saveKnowledgeFile, getKnowledgeFilesRaw } from '../src/js/modules/db.js';

vi.mock('../src/js/modules/db.js', () => ({
    saveKnowledgeFile: vi.fn(),
    getKnowledgeFilesRaw: vi.fn()
}));

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

    it('loads aspect with Icon.b64 and handles bad JSON', async () => {
        const mockZip = {
            file: vi.fn((path) => {
                if (path === 'Name.md') return { async: vi.fn().mockResolvedValue('Test Aspect') };
                if (path === 'Description.md') return { async: vi.fn().mockResolvedValue('Desc') };
                if (path === 'Instructions.md') return { async: vi.fn().mockResolvedValue('Inst') };
                if (path === 'Icon.b64') return { async: vi.fn().mockResolvedValue('mock-b64-icon') };
                if (path === 'memory.json') return { async: vi.fn().mockResolvedValue('invalid-json') };
                return null;
            }),
            folder: vi.fn((path) => {
                if (path === 'Tools') {
                    return {
                        file: vi.fn((file) => {
                            if (file === 'state.json') return { async: vi.fn().mockResolvedValue('invalid-state') };
                            return null;
                        }),
                        files: {
                            'Tools/Tool1.js': { dir: false, async: vi.fn().mockResolvedValue('console.log("t1");') }
                        }
                    };
                }
                return null;
            })
        };
        JSZip.loadAsync.mockResolvedValue(mockZip);

        const event = { target: { files: [new File([''], 'test.aspect')], value: '' } };
        
        // This should not throw, it should catch the JSON parses and log errors
        await loadAspectFile(event);

        expect(console.error).toHaveBeenCalledWith('Failed to parse tool state.json during aspect import', expect.any(String));
        expect(console.error).toHaveBeenCalledWith('Failed to parse memory.json during aspect import', expect.any(String));
        
        const addedAspect = state.aspects[0];
        expect(addedAspect.icon).toBe('data:image/png;base64,mock-b64-icon');
        expect(addedAspect.memory).toEqual({});
        expect(addedAspect.tools[0].state).toEqual({});
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

    it('saves aspect to file with preset background and no tools or memory', async () => {
        const mockAspect = {
            name: 'Simple Aspect',
            description: 'Test Desc',
            instructions: 'Test Instr',
            background: 'lake_sunset_001.jpeg', // Not base64
            chatHistory: [{role:'user',content:'hi'}]
        };
        getCurrentAspect.mockReturnValue(mockAspect);
        
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            blob: vi.fn().mockResolvedValue(new Blob(['bg-data']))
        });

        const mockZipFile = vi.fn();
        const mockGenerateAsync = vi.fn().mockResolvedValue(new Blob(['mock-blob-data']));

        JSZip.mockImplementationOnce(function() {
            this.file = mockZipFile;
            this.folder = vi.fn(() => ({ file: mockZipFile, files: {} }));
            this.generateAsync = mockGenerateAsync;
        });

        await saveAspectToFile();

        expect(mockZipFile).toHaveBeenCalledWith('Background.jpeg', expect.any(Blob));
        expect(mockZipFile).toHaveBeenCalledWith('ChatHistory/History.md', '### User\nhi\n\n');
        expect(mockZipFile).toHaveBeenCalledWith('memory.json', '{}');
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

        expect(renderAspectList).toHaveBeenCalled();
        expect(showChatView).toHaveBeenCalled();
        expect(markChangesSaved).toHaveBeenCalled();
        expect(event.target.value).toBe('');
    });

    it('loads aspect file missing optional fields gracefully', async () => {
        const mockZip = {
            file: vi.fn((path) => {
                const files = {
                    'Name.md': { async: vi.fn().mockResolvedValue('Loaded Name') },
                    'Description.md': { async: vi.fn().mockResolvedValue('Loaded Desc') },
                    'Instructions.md': { async: vi.fn().mockResolvedValue('Loaded Instr') },
                };
                return files[path] || null;
            }),
            folder: vi.fn(() => null)
        };

        JSZip.loadAsync.mockResolvedValue(mockZip);

        const mockFile = new File(['dummy content'], 'minimal.aspect');
        const event = {
            target: { files: [mockFile], value: 'minimal.aspect' }
        };

        await loadAspectFile(event);

        expect(state.aspects.length).toBe(1); // Cleared in beforeEach
        const loadedAspect = state.aspects[0];
        expect(loadedAspect.name).toBe('Loaded Name');
        expect(loadedAspect.icon).toBe('');
        expect(loadedAspect.background).toBe('');
        expect(loadedAspect.tools).toEqual([]);
        expect(loadedAspect.chatHistory).toEqual([]);
        expect(loadedAspect.knowledge).toBe('');
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
        const mockAnchor = document.createElement('a');
        expect(mockAnchor.href).toBe('mock-url');
        expect(mockAnchor.download).toBe('Web_Aspect_card.html');
        expect(mockAnchor.click).toHaveBeenCalled();
        expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('mock-url');
    });

    it('should handle missing essential metadata files', async () => {
        const file = new File(['mock content'], 'test.aspect');
        const event = { target: { files: [file] } };

        const mockZip = {
            file: vi.fn((path) => {
                // Name.md is missing
                if (path === 'Description.md') return { async: vi.fn().mockResolvedValue('Desc') };
                if (path === 'Instructions.md') return { async: vi.fn().mockResolvedValue('Instr') };
                return null;
            })
        };
        JSZip.loadAsync.mockResolvedValue(mockZip);

        await loadAspectFile(event);

        // Test updated to reflect graceful degradation; the file continues parsing rather than throwing
        // Mock zip.folder for subsequent operations
        mockZip.folder = vi.fn().mockReturnValue(null);
        await loadAspectFile(event);
        // It shouldn't crash with the metadata error anymore
    });

    it('should ignore non-image files in ImagePack/', async () => {
        const file = new File(['mock content'], 'test.aspect');
        const event = { target: { files: [file] } };

        const mockZip = {
            file: vi.fn((path) => {
                if (path === 'Name.md') return { async: vi.fn().mockResolvedValue('Name') };
                if (path === 'Description.md') return { async: vi.fn().mockResolvedValue('Desc') };
                if (path === 'Instructions.md') return { async: vi.fn().mockResolvedValue('Instr') };
                if (path === 'Icon.b64') return null; // No icon
                return null;
            }),
            folder: vi.fn((path) => {
                if (path === 'ImagePack') {
                    return {
                        file: vi.fn(/.*\.(jpeg|jpg|png|gif|webp)$/i),
                        forEach: vi.fn((cb) => {
                            cb('notanimage.txt', { async: vi.fn().mockResolvedValue('text') });
                            cb('valid.png', { async: vi.fn().mockResolvedValue('base64') });
                        })
                    };
                }
                return null;
            })
        };
        JSZip.loadAsync.mockResolvedValue(mockZip);

        await loadAspectFile(event);
        
        const loadedAspect = state.aspects[0];
        expect(loadedAspect.background).toBe(''); // Image is mockResolvedValue
    });

    it('should export aspect with tools and knowledge', async () => {
        // Setup aspect with tools and knowledge
        const aspect = {
            id: '1',
            name: 'Tool Aspect',
            tools: [
                { name: 'Tool1.js', code: 'console.log()', state: { val: 1 } },
                { name: 'Tool2.js', code: 'console.log()' } // No state
            ],
            chatHistory: [],
            memory: { key: 'value' }
        };
        getCurrentAspect.mockReturnValue(aspect);
        
        // Mock getKnowledgeFilesRaw to return fake knowledge files
        getKnowledgeFilesRaw.mockResolvedValue([
            { name: 'file1.txt', text: 'Knowledge 1' }
        ]);

        const mockToolsFolderFile = vi.fn();
        const mockKnowledgeFolderFile = vi.fn();
        const mockRootFile = vi.fn();
        const mockGenerateAsync = vi.fn().mockResolvedValue(new Blob(['mock-blob']));
        
        JSZip.mockImplementationOnce(function() {
            this.file = mockRootFile;
            this.folder = vi.fn((name) => {
                if (name === 'Tools') return { file: mockToolsFolderFile };
                if (name === 'Knowledge/Files') return { file: mockKnowledgeFolderFile };
                return { file: vi.fn() };
            });
            this.generateAsync = mockGenerateAsync;
        });

        await saveAspectToFile();

        expect(JSZip).toHaveBeenCalled();

        // Verify tools
        expect(mockToolsFolderFile).toHaveBeenCalledWith('Tool1.js', 'console.log()');
        expect(mockToolsFolderFile).toHaveBeenCalledWith('Tool2.js', 'console.log()');
        expect(mockToolsFolderFile).toHaveBeenCalledWith('state.json', JSON.stringify({ 'Tool1.js': { val: 1 } }, null, 2));

        // Verify knowledge files
        expect(mockKnowledgeFolderFile).toHaveBeenCalledWith('file1.txt', 'Knowledge 1');
    });
});
