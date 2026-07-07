# Aspect Studio 🌸

Aspect Studio is a sleek, beautiful, fully local web app designed to let you build, run, and share autonomous AI personas (Aspects). 

It connects to any OpenAI-compatible API (Cohere, Groq, Cerebras, OpenRouter, ArliAI, LM Studio, etc.) and allows you to give each persona its own memory, knowledge bank, and executable tools.

## Features ✨

### 1. Modern Chat UX
- **Live Markdown Streaming:** See the AI's thoughts rendered perfectly as it types, complete with syntax-highlighted code blocks (using highlight.js).
- **Inline Editing:** Edit any of the AI's previous messages directly in the chat to steer the conversation.
- **Context Window Management:** Set strict limits on conversation length to save on tokens, while maintaining the Aspect's core identity.

### 2. In-App Editor & Tools
- **CodeMirror 6 Integration:** Build JavaScript tools right inside the app using a powerful dark-mode code editor.
- **State Persistence:** Tools can track and maintain their own internal state (e.g., counters, cache, authentication tokens) securely between runs via the Web Worker environment.
- **System Tool Library:** A built-in library of safe, predefined tools (Calculator, Weather, DateTime) that can be instantly added to any Aspect.

### 3. The Polished Product
- **Dark Mode:** A beautiful, eye-friendly dark theme that can be toggled instantly from the settings menu.
- **Toast Notifications:** A modern, non-blocking notification system that smoothly slides in to keep you informed of successes or errors.
- **Aspect Hub Export:** Export any Aspect into a standalone, beautifully styled HTML "Profile Card" that can be hosted anywhere or shared with friends!

## Getting Started 🚀

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the development server:
   ```bash
   npm run dev
   ```
3. Open `http://localhost:5173/` in your browser.
4. Click the gear icon to open **API Settings** and enter your preferred provider and API key.

## Creating an Aspect 🎭

- **Aspect Name & Description:** Give your AI a personality.
- **System Prompt (Instructions):** Define the rules of engagement.
- **Knowledge Base:** Upload `.txt`, `.md`, or `.docx` files to give your Aspect internal context.
- **Tools:** Write custom JavaScript tools that your Aspect can execute autonomously (e.g., `[Run Tool: Calculator({"expression":"2+2"})]`).
- **Save & Export:** When you are done customizing, click **💾 Download .aspect** to save your work, or **🌐 Export Webpage** to create a shareable HTML card!

---

*Built with ❤️ in pure HTML, CSS, and Vanilla JavaScript.*
