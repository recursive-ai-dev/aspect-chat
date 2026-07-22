import { state } from './state.js';
import { getCurrentAspect } from './aspects.js';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { sendAIRequest } from './tools.js';
import { markChangesUnsaved } from './ui.js';


export function escapeHtml(str) {
            return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
        }

        export function renderChatMessages() {
            const container = document.getElementById('chat-messages');
            const aspect = getCurrentAspect();
            if (!aspect || !aspect.chatHistory) {
                container.innerHTML = '';
                return;
            }

            // Simple DOM diffing: ensure we have the right number of wrapper elements
            while (container.children.length > aspect.chatHistory.length) {
                container.removeChild(container.lastChild);
            }
            while (container.children.length < aspect.chatHistory.length) {
                const wrapper = document.createElement('div');
                container.appendChild(wrapper);
            }
            
            aspect.chatHistory.forEach((msg, index) => {
                const wrapper = container.children[index];
                const content = msg.content || '';
                
                if (msg.role === 'system') {
                    if (wrapper.className !== 'message-wrapper system-log' || wrapper.children.length !== 1 || !wrapper.firstChild || wrapper.firstChild.className !== '') {
                        wrapper.className = 'message-wrapper system-log';
                        wrapper.innerHTML = '<div></div>';
                    }
                    const bubble = wrapper.firstChild;
                    if (msg._renderedHtml === undefined || msg._renderedContent !== content) {
                        msg._renderedHtml = DOMPurify.sanitize(marked.parse(content));
                        msg._renderedContent = content;
                    }
                    if (bubble.innerHTML !== msg._renderedHtml) {
                        bubble.innerHTML = msg._renderedHtml;
                    }
                } else {
                    if (wrapper.className !== `message-wrapper ${msg.role}`) {
                        wrapper.className = `message-wrapper ${msg.role}`;
                    }
                    
                    if (msg._isEditing) {
                        wrapper.innerHTML = ''; // reset for edit view
                        const editorContainer = document.createElement('div');
                        editorContainer.className = 'inline-editor-container';
                        
                        const textarea = document.createElement('textarea');
                        textarea.className = 'inline-editor-textarea';
                        textarea.value = msg.content;
                        
                        const btnGroup = document.createElement('div');
                        btnGroup.className = 'inline-editor-btns';
                        
                        const saveBtn = document.createElement('button');
                        saveBtn.className = 'save-btn';
                        saveBtn.innerText = 'Save & Submit';
                        saveBtn.onclick = () => submitEdit(index, textarea.value);
                        
                        const cancelBtn = document.createElement('button');
                        cancelBtn.className = 'settings-btn danger-btn';
                        cancelBtn.innerText = 'Cancel';
                        cancelBtn.onclick = () => cancelEdit(index);
                        
                        btnGroup.appendChild(cancelBtn);
                        btnGroup.appendChild(saveBtn);
                        
                        editorContainer.appendChild(textarea);
                        editorContainer.appendChild(btnGroup);
                        
                        wrapper.appendChild(editorContainer);
                    } else {
                        if (wrapper.children.length !== 2 || wrapper.firstChild.className !== `message-bubble ${msg.role}`) {
                             wrapper.innerHTML = `<div class="message-bubble ${msg.role}"></div><div class="message-actions"></div>`;
                        }
                        const bubble = wrapper.children[0];
                        const actions = wrapper.children[1];

                        // Escape user input, render and sanitize assistant output (memoized per content)
                        if (msg._renderedHtml === undefined || msg._renderedContent !== content) {
                            msg._renderedHtml = msg.role === 'user' ? escapeHtml(content) : DOMPurify.sanitize(marked.parse(content));
                            msg._renderedContent = content;
                        }
                        if (bubble.innerHTML !== msg._renderedHtml) {
                            bubble.innerHTML = msg._renderedHtml;
                        }
                        
                        // We must bind correct index to action buttons every time because indices can shift
                        if (msg.role === 'user') {
                            actions.innerHTML = `
                                <button class="msg-action-btn" onclick="editMessage(${index})" title="Edit message">✏️</button>
                                <button class="msg-action-btn" onclick="deleteMessage(${index})" title="Delete message">🗑️</button>
                            `;
                        } else if (msg.role === 'assistant') {
                            actions.innerHTML = `
                                <button class="msg-action-btn" onclick="regenerateMessage(${index})" title="Regenerate from here">🔄</button>
                                <button class="msg-action-btn" onclick="deleteMessage(${index})" title="Delete message">🗑️</button>
                            `;
                        }
                    }
                }
            });
            container.scrollTop = container.scrollHeight;
        }

        export function deleteMessage(index) {
            if (state.abortController) return; // Prevent deleting while generating
            const aspect = getCurrentAspect();
            if (!aspect || !aspect.chatHistory) return;
            aspect.chatHistory.splice(index, 1);
            markChangesUnsaved();
            renderChatMessages();
        }

        export async function regenerateMessage(index) {
            if (state.abortController) return; // Prevent regenerating while already generating
            const aspect = getCurrentAspect();
            if (!aspect || !aspect.chatHistory) return;
            // Delete this message and all subsequent messages
            aspect.chatHistory.splice(index);
            markChangesUnsaved();
            renderChatMessages();
            await sendAIRequest();
        }

        export function editMessage(index) {
            if (state.abortController) return; // Prevent editing while generating
            const aspect = getCurrentAspect();
            if (!aspect || !aspect.chatHistory) return;
            
            const msg = aspect.chatHistory[index];
            if (msg.role !== 'user') return;
            
            msg._isEditing = true;
            renderChatMessages();
        }

        export function cancelEdit(index) {
            const aspect = getCurrentAspect();
            if (!aspect || !aspect.chatHistory) return;
            
            const msg = aspect.chatHistory[index];
            delete msg._isEditing;
            renderChatMessages();
        }

        export function submitEdit(index, newContent) {
            const aspect = getCurrentAspect();
            if (!aspect || !aspect.chatHistory) return;
            
            const msg = aspect.chatHistory[index];
            delete msg._isEditing;
            
            if (newContent !== null && newContent.trim() !== '') {
                // Update content and truncate history after this message
                msg.content = newContent.trim();
                aspect.chatHistory.splice(index + 1);
                markChangesUnsaved();
                renderChatMessages();
                sendAIRequest().catch(console.error); // auto regenerate
            } else {
                renderChatMessages();
            }
        }

        export function createStreamingBubble() {
            const container = document.getElementById('chat-messages');
            const wrapper = document.createElement('div');
            wrapper.className = `message-wrapper assistant streaming`;
            
            const bubble = document.createElement('div');
            bubble.className = `message-bubble assistant`;
            bubble.innerHTML = "...";
            
            wrapper.appendChild(bubble);
            container.appendChild(wrapper);
            container.scrollTop = container.scrollHeight;
            return bubble;
        }

        let lastStreamUpdate = 0;
        export function updateStreamingBubble(bubble, content, force = false) {
            const now = Date.now();
            if (force || now - lastStreamUpdate > 50) { // throttle parsing to every 50ms
                bubble.innerHTML = DOMPurify.sanitize(marked.parse(content));
                const container = document.getElementById('chat-messages');
                container.scrollTop = container.scrollHeight;
                lastStreamUpdate = now;
            }
        }

        export function toggleToolsDropdown() {
            document.getElementById('tools-dropdown').classList.toggle('show');
        }
