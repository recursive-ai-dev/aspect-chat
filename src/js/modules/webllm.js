import { CreateMLCEngine, prebuiltAppConfig } from "@mlc-ai/web-llm";

let engine = null;
let currentModelId = null;

export async function getWebLLMModels() {
    return prebuiltAppConfig.model_list.map(m => m.model_id);
}

export async function initWebLLMEngine(modelId, initProgressCallback) {
    if (engine && currentModelId === modelId) {
        return engine;
    }

    engine = await CreateMLCEngine(modelId, { initProgressCallback });
    currentModelId = modelId;
    return engine;
}

export function getEngine() {
    return engine;
}
