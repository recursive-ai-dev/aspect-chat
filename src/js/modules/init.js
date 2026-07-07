import { fetchModelsIfPossible } from './settings.js';
import { loadDefaultAspects } from './aspects.js';
import { state } from './state.js';
import { marked } from 'marked';


        export function init() {
            document.getElementById('api-url-input').value = state.settings.apiUrl;
            document.getElementById('api-key-input').value = state.settings.apiKey;
            document.getElementById('api-model-input').value = state.settings.model;
            const providerSelect = document.getElementById('api-provider-select');
            if (providerSelect) {
                providerSelect.value = state.settings.provider || 'custom';
            }
            if (state.settings.provider && state.settings.provider !== 'custom') {
                fetchModelsIfPossible();
            }
            
            marked.setOptions({
                breaks: true,
                gfm: true
            });

            loadDefaultAspects();
            
            // Auto-resize chat input
            const chatInput = document.getElementById('chat-input');
            chatInput.addEventListener('input', function() {
                this.style.height = 'auto';
                this.style.height = (this.scrollHeight) + 'px';
            });
        }
