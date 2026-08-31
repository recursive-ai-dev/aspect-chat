import { cancelCreateAspect } from './aspects.js';
import { state } from './state.js';


        export function openSettings() {
            document.getElementById('settings-modal').classList.remove('hidden');
            document.getElementById('settings-modal').style.display = 'flex';
        }
        export function saveSettings() {
            state.settings.apiUrl = document.getElementById('api-url-input').value.trim();
            state.settings.apiKey = document.getElementById('api-key-input').value.trim();
            state.settings.model = document.getElementById('api-model-input').value.trim();
            state.settings.maxContext = parseInt(document.getElementById('api-max-context-input').value) || 20;
            const providerSelect = document.getElementById('api-provider-select');
            if (providerSelect) {
                state.settings.provider = providerSelect.value;
                localStorage.setItem('provider', state.settings.provider);
            }
            localStorage.setItem('apiUrl', state.settings.apiUrl);
            sessionStorage.removeItem('apiKey');
            localStorage.removeItem('apiKey'); // Security cleanup
            localStorage.setItem('model', state.settings.model);
            localStorage.setItem('maxContext', state.settings.maxContext);
            
            const isDarkMode = document.getElementById('dark-mode-toggle').checked;
            localStorage.setItem('darkMode', isDarkMode);
            if (isDarkMode) {
                document.body.classList.add('dark-theme');
            } else {
                document.body.classList.remove('dark-theme');
            }
            
            document.getElementById('settings-modal').classList.add('hidden');
        }

        export function onProviderSelect() {
            const providerSelect = document.getElementById('api-provider-select');
            const urlInput = document.getElementById('api-url-input');
            
            if (providerSelect.value !== 'custom') {
                urlInput.value = providerSelect.value;
            }
            fetchModelsIfPossible();
        }

        export async function fetchProviderModels(url, key) {
            let fetchUrl = url;
            if (!fetchUrl.endsWith('/models') && !fetchUrl.endsWith('/models/')) {
                fetchUrl = fetchUrl.replace(/\/+$/, '') + '/models';
            }

            const headers = {};
            if (key) {
                headers['Authorization'] = `Bearer ${key}`;
            }

            const response = await fetch(fetchUrl, { headers }).catch(e => {
                throw new Error(`Network error: ${e.message}`);
            });

            if (!response.ok) {
                let errMsg = response.statusText;
                try {
                    const errData = await response.json();
                    errMsg = errData.error?.message || errData.message || errMsg;
                } catch(e){
                    console.warn("Failed to parse error response JSON", e.message);
                }
                if (response.status === 401 || response.status === 403) {
                    throw new Error(`Unauthorized or invalid API key (${response.status}).`);
                } else if (response.status === 429) {
                    throw new Error(`Rate limit exceeded (${response.status}).`);
                } else {
                    throw new Error(`Error ${response.status}: ${errMsg}`);
                }
            }

            const data = await response.json();
            const models = data.data || data.models || [];

            if (!Array.isArray(models) || models.length === 0) {
                throw new Error("No models found.");
            }
            return models;
        }

        export function updateModelSelectUI(models, modelSelect, modelInput, statusDiv) {
            modelSelect.innerHTML = '';
            models.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m.id;
                opt.innerText = m.id;
                modelSelect.appendChild(opt);
            });

            if (Array.from(modelSelect.options).some(o => o.value === modelInput.value)) {
                modelSelect.value = modelInput.value;
            } else {
                modelInput.value = modelSelect.value;
            }

            modelInput.classList.add('hidden');
            modelSelect.classList.remove('hidden');
            statusDiv.innerText = 'Models fetched successfully.';
            statusDiv.style.color = 'var(--accent-primary)';
        }

        export async function fetchModelsIfPossible() {
            const url = document.getElementById('api-url-input').value.trim();
            const key = document.getElementById('api-key-input').value.trim();
            const statusDiv = document.getElementById('model-fetch-status');
            const modelInput = document.getElementById('api-model-input');
            const modelSelect = document.getElementById('api-model-select');
            const providerSelect = document.getElementById('api-provider-select');
            
            if (!url) return;
            
            modelInput.classList.remove('hidden');
            modelSelect.classList.add('hidden');
            statusDiv.innerText = '';
            statusDiv.style.color = 'var(--text-light)';

            if (providerSelect.value === 'custom') {
                return;
            }

            if (!key && providerSelect.value !== 'http://localhost:1234/v1') {
                statusDiv.innerText = 'Please enter an API key to fetch available models.';
                return;
            }

            statusDiv.innerText = 'Fetching models...';
            
            try {
                const models = await fetchProviderModels(url, key);
                updateModelSelectUI(models, modelSelect, modelInput, statusDiv);
            } catch (err) {
                statusDiv.innerText = err.message;
                statusDiv.style.color = '#cc5a5a';
            }
        }

        export function onModelSelectDropdown() {
            document.getElementById('api-model-input').value = document.getElementById('api-model-select').value;
        }

        window.addEventListener('click', function(event) {
            const createModal = document.getElementById('create-aspect-modal');
            if (createModal && event.target === createModal) {
                cancelCreateAspect();
            }
            const settingsModal = document.getElementById('settings-modal');
            if (settingsModal && event.target === settingsModal) {
                settingsModal.classList.add('hidden');
            }
        });
        window.addEventListener('keydown', function(event) {
            if (event.key === 'Escape') {
                const createModal = document.getElementById('create-aspect-modal');
                if (createModal && !createModal.classList.contains('hidden')) {
                    cancelCreateAspect();
                }
                const settingsModal = document.getElementById('settings-modal');
                if (settingsModal && !settingsModal.classList.contains('hidden')) {
                    settingsModal.classList.add('hidden');
                }
            }
        });
