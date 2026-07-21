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
            container.innerHTML = '';
            const aspect = getCurrentAspect();
            if (!aspect || !aspect.chatHistory) return;
            
            aspect.chatHistory.forEach((msg, index) => {
                const wrapper = document.createElement('div');
                const content = msg.content || '';
                
                if (msg.role === 'system') {
                    wrapper.className = 'message-wrapper system-log';
                    const bubble = document.createElement('div');
                    // Use DOMPurify to prevent XSS attacks from model output
                    bubble.innerHTML = DOMPurify.sanitize(marked.parse(content));
                    wrapper.appendChild(bubble);
                } else {
                    wrapper.className = `message-wrapper ${msg.role}`;
                    
                    if (msg._isEditing) {
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
                        const bubble = document.createElement('div');
                        bubble.className = `message-bubble ${msg.role}`;
                        // Escape user input, render and sanitize assistant output (memoized per content)
                        let bubbleHtml;
                        if (typeof msg === 'object' && msg !== null) {
                            if (msg._renderedHtml === undefined || msg._renderedContent !== content) {
                                msg._renderedHtml = msg.role === 'user' ? escapeHtml(content) : DOMPurify.sanitize(marked.parse(content));
                                msg._renderedContent = content;
                            }
                            bubbleHtml = msg._renderedHtml;
                        } else {
                            bubbleHtml = msg.role === 'user' ? escapeHtml(content) : DOMPurify.sanitize(marked.parse(content));
                        }
                        bubble.innerHTML = bubbleHtml;
                        
                        const actions = document.createElement('div');
                        actions.className = 'message-actions';
                        
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
                        
                        wrapper.appendChild(bubble);
                        wrapper.appendChild(actions);
                    }
                }
                
                container.appendChild(wrapper);
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
                sendAIRequest(); // auto regenerate
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
