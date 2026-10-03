import { env, pipeline } from '@huggingface/transformers';
import wasmURL from '../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url';
import wasmModuleURL from '../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url';

env.allowLocalModels = true;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.wasmPaths = { wasm: wasmURL, mjs: wasmModuleURL };
let extractor;
let mode;
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
    queue = queue.then(async () => {
        try {
            if (!extractor || mode !== data.allowDownloads) {
                if (extractor) await extractor.dispose();
                env.allowRemoteModels = !!data.allowDownloads;
                env.localModelPath = data.modelBase;
                mode = data.allowDownloads;
                extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8', device: 'wasm' });
            }
            const vectors = [];
            for (const text of data.texts) {
                const output = await extractor(text, { pooling: 'mean', normalize: true });
                vectors.push(Array.from(output.data));
            }
            self.postMessage({ id: data.id, vectors });
        } catch (error) {
            extractor = null;
            self.postMessage({ id: data.id, error: error.message });
        }
    });
};
