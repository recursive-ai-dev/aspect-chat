


        export let state = {
            settings: {
                apiUrl: localStorage.getItem('apiUrl') || '',
                apiKey: sessionStorage.getItem('apiKey') || '',
                model: localStorage.getItem('model') || '',
                provider: localStorage.getItem('provider') || 'custom',
                maxContext: parseInt(localStorage.getItem('maxContext')) || 20
            },
            aspects: [],
            currentAspectId: null,
            hasUnsavedChanges: false,
            consecutiveToolRuns: 0,
            abortController: null
        };

        export function saveAspectsToLocalStorage() {
            localStorage.setItem('aspects_data', JSON.stringify(state.aspects));
        }

        export function markChangesSaved() {
            state.hasUnsavedChanges = false;
            document.getElementById('save-reminder').classList.add('hidden');
            document.getElementById('sidebar-save-btn').classList.remove('pulsate');
            saveAspectsToLocalStorage();
        }
