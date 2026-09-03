import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as webllm from '../src/js/modules/webllm.js';

// Mock @mlc-ai/web-llm
vi.mock('@mlc-ai/web-llm', () => ({
    prebuiltAppConfig: {
        model_list: [
            { model_id: 'Llama-3-8B-Instruct-q4f32_1-MLC' },
            { model_id: 'Phi-3-mini-4k-instruct-q4f16_1-MLC' }
        ]
    },
    CreateMLCEngine: vi.fn().mockImplementation((modelId, options) => {
        return Promise.resolve({ mockedEngine: true, modelId });
    })
}));

describe('WebLLM Module', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        webllm.resetWebLLMForTesting();
        // WebLLM requires WebGPU, which jsdom does not implement. Stub the
        // capability check so the engine lifecycle itself can be tested.
        if (!navigator.gpu) {
            Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true });
        }
    });

    it('getWebLLMModels should return list of model IDs', async () => {
        const models = await webllm.getWebLLMModels();
        expect(models).toEqual([
            'Llama-3-8B-Instruct-q4f32_1-MLC',
            'Phi-3-mini-4k-instruct-q4f16_1-MLC'
        ]);
    });

    it('initWebLLMEngine should initialize a new engine if none exists', async () => {
        const initCb = vi.fn();
        const engine = await webllm.initWebLLMEngine('model-1', initCb);
        
        expect(engine).toBeDefined();
        expect(engine.modelId).toBe('model-1');
        expect(webllm.getEngine()).toBe(engine);
    });

    it('initWebLLMEngine should return existing engine if modelId matches', async () => {
        const initCb = vi.fn();
        // Initial call already set the engine to model-1 in previous test,
        // Wait, vitest tests might run concurrently or sequentially, but module state is shared.
        // Let's explicitly set it.
        const engine1 = await webllm.initWebLLMEngine('model-1', initCb);
        
        const { CreateMLCEngine } = await import('@mlc-ai/web-llm');
        CreateMLCEngine.mockClear();

        const engine2 = await webllm.initWebLLMEngine('model-1', initCb);
        expect(engine2).toBe(engine1);
        expect(CreateMLCEngine).not.toHaveBeenCalled();
    });

    it('initWebLLMEngine should create new engine if modelId changes', async () => {
        const initCb = vi.fn();
        await webllm.initWebLLMEngine('model-1', initCb);
        
        const { CreateMLCEngine } = await import('@mlc-ai/web-llm');
        CreateMLCEngine.mockClear();

        const engine = await webllm.initWebLLMEngine('model-2', initCb);
        expect(engine.modelId).toBe('model-2');
        expect(CreateMLCEngine).toHaveBeenCalledWith('model-2', { initProgressCallback: initCb });
    });

    it('isWebGPUAvailable reflects navigator.gpu', () => {
        expect(webllm.isWebGPUAvailable()).toBe(true);
    });

    it('initWebLLMEngine refuses without WebGPU and explains why', async () => {
        const original = navigator.gpu;
        Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
        await expect(webllm.initWebLLMEngine('model-1')).rejects.toThrow('WebGPU');
        Object.defineProperty(navigator, 'gpu', { value: original, configurable: true });
    });

    it('initWebLLMEngine requires a model id', async () => {
        await expect(webllm.initWebLLMEngine('')).rejects.toThrow('No WebLLM model selected');
    });

    it('concurrent initialisation for the same model shares one engine build', async () => {
        const { CreateMLCEngine } = await import('@mlc-ai/web-llm');
        CreateMLCEngine.mockClear();

        const [a, b] = await Promise.all([
            webllm.initWebLLMEngine('model-shared'),
            webllm.initWebLLMEngine('model-shared')
        ]);

        expect(a).toBe(b);
        // Without request coalescing this would start two multi-gigabyte downloads.
        expect(CreateMLCEngine).toHaveBeenCalledTimes(1);
    });

    it('a failed load leaves no half-built engine behind', async () => {
        const { CreateMLCEngine } = await import('@mlc-ai/web-llm');
        CreateMLCEngine.mockRejectedValueOnce(new Error('out of memory'));

        await expect(webllm.initWebLLMEngine('broken-model')).rejects.toThrow('out of memory');
        expect(webllm.getEngine()).toBeNull();
    });
});
