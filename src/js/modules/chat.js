import { getCurrentAspect } from './aspects.js';
import DOMPurify from 'dompurify';
import { marked } from 'marked';


        export function escapeHtml(str) {
            return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
        }

        export function renderChatMessages() {
            const container = document.getElementById('chat-messages');
            container.innerHTML = '';
            const aspect = getCurrentAspect();
            if (!aspect || !aspect.chatHistory) return;
            
            aspect.chatHistory.forEach(msg => {
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
                    const bubble = document.createElement('div');
                    bubble.className = `message-bubble ${msg.role}`;
                    // Escape user input, render and sanitize assistant output
                    bubble.innerHTML = msg.role === 'user' ? escapeHtml(content) : DOMPurify.sanitize(marked.parse(content));
                    wrapper.appendChild(bubble);
                }
                
                container.appendChild(wrapper);
            });
            container.scrollTop = container.scrollHeight;
        }

        export function toggleToolsDropdown() {
            document.getElementById('tools-dropdown').classList.toggle('show');
        }
