import { fetchModelsIfPossible } from './settings.js';
import { loadDefaultAspects } from './aspects.js';
import { state } from './state.js';
import { marked } from 'marked';


        export function init() {
            document.getElementById('api-url-input').value = state.settings.apiUrl;
            document.getElementById('api-key-input').value = state.settings.apiKey;
            document.getElementById('api-model-input').value = state.settings.model;
            document.getElementById('api-max-context-input').value = state.settings.maxContext;
            const providerSelect = document.getElementById('api-provider-select');
            if (providerSelect) {
                providerSelect.value = state.settings.provider || 'custom';
            }
            if (state.settings.provider && state.settings.provider !== 'custom') {
                fetchModelsIfPossible();
            }
            
            // Dark Mode Initialization
            const isDarkMode = localStorage.getItem('darkMode') === 'true';
            document.getElementById('dark-mode-toggle').checked = isDarkMode;
            if (isDarkMode) {
                document.body.classList.add('dark-theme');
                const slider = document.getElementById('dark-mode-slider');
                if (slider) slider.style.transform = 'translateX(22px)';
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
