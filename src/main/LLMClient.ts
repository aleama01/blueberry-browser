import { WebContents } from "electron";
import { streamText, type LanguageModel, type CoreMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import * as dotenv from "dotenv";
import { join } from "path";
import type { Window } from "./Window";

// Load environment variables from .env file
dotenv.config({ path: join(__dirname, "../../.env") });

export type ChatMode = 'chat' | 'agent';

interface ChatRequest {
  message: string;
  messageId: string;
  mode?: ChatMode;
}

interface StreamChunk {
  content: string;
  isComplete: boolean;
}

type LLMProvider = "openai" | "anthropic";

const DEFAULT_MODELS: Record<LLMProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-sonnet-20241022",
};

const MAX_CONTEXT_LENGTH = 4000;
const DEFAULT_TEMPERATURE = 0.7;

export class LLMClient {
  private readonly webContents: WebContents;
  private window: Window | null = null;
  private readonly provider: LLMProvider;
  private readonly modelName: string;
  private readonly model: LanguageModel | null;
  private messages: CoreMessage[] = [];

  constructor(webContents: WebContents) {
    this.webContents = webContents;
    this.provider = this.getProvider();
    this.modelName = this.getModelName();
    this.model = this.initializeModel();

    this.logInitializationStatus();
  }

  // Set the window reference after construction to avoid circular dependencies
  setWindow(window: Window): void {
    this.window = window;
  }

  private getProvider(): LLMProvider {
    const provider = process.env.LLM_PROVIDER?.toLowerCase();
    if (provider === "anthropic") return "anthropic";
    return "openai"; // Default to OpenAI
  }

  private getModelName(): string {
    return process.env.LLM_MODEL || DEFAULT_MODELS[this.provider];
  }

  private initializeModel(): LanguageModel | null {
    const apiKey = this.getApiKey();
    if (!apiKey) return null;

    switch (this.provider) {
      case "anthropic":
        return anthropic(this.modelName);
      case "openai":
        return openai(this.modelName);
      default:
        return null;
    }
  }

  private getApiKey(): string | undefined {
    switch (this.provider) {
      case "anthropic":
        return process.env.ANTHROPIC_API_KEY;
      case "openai":
        return process.env.OPENAI_API_KEY;
      default:
        return undefined;
    }
  }

  private logInitializationStatus(): void {
    if (this.model) {
      console.log(
        `✅ LLM Client initialized with ${this.provider} provider using model: ${this.modelName}`
      );
    } else {
      const keyName =
        this.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
      console.error(
        `❌ LLM Client initialization failed: ${keyName} not found in environment variables.\n` +
          `Please add your API key to the .env file in the project root.`
      );
    }
  }

  async sendChatMessage(request: ChatRequest): Promise<void> {
    try {
      // Get screenshot from active tab if available
      let screenshot: string | null = null;
      if (this.window) {
        const activeTab = this.window.activeTab;
        if (activeTab) {
          try {
            const image = await activeTab.screenshot();
            screenshot = image.toDataURL();
          } catch (error) {
            console.error("Failed to capture screenshot:", error);
          }
        }
      }

      // Build user message content with screenshot first, then text
      const userContent: any[] = [];
      
      // Add screenshot as the first part if available
      if (screenshot) {
        userContent.push({
          type: "image",
          image: screenshot,
        });
      }
      
      // Add text content
      userContent.push({
        type: "text",
        text: request.message,
      });

      // Create user message in CoreMessage format
      const userMessage: CoreMessage = {
        role: "user",
        content: userContent.length === 1 ? request.message : userContent,
      };
      
      this.messages.push(userMessage);

      // Send updated messages to renderer
      this.sendMessagesToRenderer();

      if (!this.model) {
        this.sendErrorMessage(
          request.messageId,
          "LLM service is not configured. Please add your API key to the .env file."
        );
        return;
      }

      const messages = await this.prepareMessagesWithContext(request);
      await this.streamResponse(messages, request.messageId);
    } catch (error) {
      console.error("Error in LLM request:", error);
      this.handleStreamError(error, request.messageId);
    }
  }

  clearMessages(): void {
    this.messages = [];
    this.sendMessagesToRenderer();
  }

  getMessages(): CoreMessage[] {
    return this.messages;
  }

  private sendMessagesToRenderer(): void {
    this.webContents.send("chat-messages-updated", this.messages);
  }

  private async prepareMessagesWithContext(request: ChatRequest): Promise<CoreMessage[]> {
    // Get page context from active tab
    let pageUrl: string | null = null;
    let pageText: string | null = null;
    let domStructure: string | null = null;
    
    if (this.window) {
      const activeTab = this.window.activeTab;
      if (activeTab) {
        pageUrl = activeTab.url;
        try {
          pageText = await activeTab.getTabText();
          
          // In agent mode, also get DOM structure hints
          if (request.mode === 'agent') {
            domStructure = await this.getDOMStructureHints(activeTab);
          }
        } catch (error) {
          console.error("Failed to get page context:", error);
        }
      }
    }

    // Build system message with mode-specific prompt
    const systemMessage: CoreMessage = {
      role: "system",
      content: this.buildSystemPrompt(pageUrl, pageText, domStructure, request.mode || 'chat'),
    };

    // Include all messages in history (system + conversation)
    return [systemMessage, ...this.messages];
  }

  /**
   * Get helpful DOM structure hints for the coding agent
   */
  private async getDOMStructureHints(tab: any): Promise<string> {
    try {
      const hints = await tab.runJs(`
        (function() {
          const hints = [];
          
          // Count common elements
          const forms = document.querySelectorAll('form');
          const inputs = document.querySelectorAll('input');
          const buttons = document.querySelectorAll('button');
          const links = document.querySelectorAll('a');
          const images = document.querySelectorAll('img');
          
          if (forms.length > 0) hints.push(\`\${forms.length} form(s)\`);
          if (inputs.length > 0) hints.push(\`\${inputs.length} input field(s)\`);
          if (buttons.length > 0) hints.push(\`\${buttons.length} button(s)\`);
          if (links.length > 0) hints.push(\`\${links.length} link(s)\`);
          if (images.length > 0) hints.push(\`\${images.length} image(s)\`);
          
          // Detect common frameworks
          const frameworks = [];
          if (window.React) frameworks.push('React');
          if (window.Vue) frameworks.push('Vue');
          if (window.angular) frameworks.push('Angular');
          if (window.jQuery || window.$) frameworks.push('jQuery');
          
          // Get form field names/IDs for context
          const formFields = Array.from(inputs).slice(0, 10).map(input => {
            const id = input.id || input.name || input.className || 'unnamed';
            const type = input.type || 'text';
            return \`\${type}[\${id}]\`;
          });
          
          // Get button texts
          const buttonTexts = Array.from(buttons).slice(0, 5).map(btn => 
            btn.textContent?.trim() || 'unlabeled'
          );
          
          return {
            summary: hints.join(', '),
            frameworks: frameworks.length > 0 ? frameworks.join(', ') : 'Vanilla JS',
            formFields: formFields.slice(0, 5),
            buttons: buttonTexts
          };
        })();
      `);
      
      const parts: string[] = [];
      if (hints.summary) {
        parts.push(`DOM Elements: ${hints.summary}`);
      }
      if (hints.frameworks) {
        parts.push(`Detected Framework: ${hints.frameworks}`);
      }
      if (hints.formFields && hints.formFields.length > 0) {
        parts.push(`Sample Input Fields: ${hints.formFields.join(', ')}`);
      }
      if (hints.buttons && hints.buttons.length > 0) {
        const buttonList = hints.buttons.map((b: string) => `"${b}"`).join(', ');
        parts.push(`Sample Buttons: ${buttonList}`);
      }
      
      return parts.length > 0 ? '\n' + parts.join('\n') : '';
    } catch (error) {
      console.error("Failed to get DOM structure:", error);
      return '';
    }
  }

  private buildSystemPrompt(
    url: string | null, 
    pageText: string | null, 
    domStructure: string | null,
    mode: ChatMode
  ): string {
    if (mode === 'agent') {
      return this.buildAgentSystemPrompt(url, pageText, domStructure);
    }
    return this.buildChatSystemPrompt(url, pageText);
  }

  private buildChatSystemPrompt(url: string | null, pageText: string | null): string {
    const parts: string[] = [
      "You are a helpful AI assistant integrated into a web browser.",
      "You can analyze and discuss web pages with the user.",
      "The user's messages may include screenshots of the current page as the first image.",
    ];

    if (url) {
      parts.push(`\nCurrent page URL: ${url}`);
    }

    if (pageText) {
      const truncatedText = this.truncateText(pageText, MAX_CONTEXT_LENGTH);
      parts.push(`\nPage content (text):\n${truncatedText}`);
    }

    parts.push(
      "\nPlease provide helpful, accurate, and contextual responses about the current webpage.",
      "If the user asks about specific content, refer to the page content and/or screenshot provided."
    );

    return parts.join("\n");
  }

  private buildAgentSystemPrompt(url: string | null, pageText: string | null, domStructure: string | null): string {
    const parts: string[] = [
      "You are an expert JavaScript coding agent integrated into a web browser.",
      "Your task is to generate executable JavaScript code that manipulates the current webpage.",
      "The user will describe a task, and you should generate clean, safe, and working code.",
      "",
      "═══ CORE CAPABILITIES ═══",
      "• DOM Manipulation: Find, modify, create, or remove elements",
      "• Form Automation: Fill inputs, select options, click buttons",
      "• Data Extraction: Scrape and structure data from the page",
      "• Style Modification: Change colors, layout, visibility, animations",
      "• Event Simulation: Click, scroll, submit forms, trigger events",
      "• Content Injection: Add new elements, modify existing content",
      "",
      "═══ CODE REQUIREMENTS ═══",
      "✓ Use modern JavaScript (ES6+)",
      "✓ Return a value (data extraction) or indicate success (true/false)",
      "✓ Handle errors gracefully with try-catch",
      "✓ Use specific selectors (IDs, classes, data attributes)",
      "✓ Add null checks before accessing properties",
      "✓ Include brief comments for complex logic",
      "✗ Do NOT use require(), import, or Node.js APIs",
      "✗ Do NOT use external libraries (jQuery, etc.) unless already on page",
      "✗ Do NOT make dangerous modifications without user request",
      "",
      "═══ DOM SELECTION PATTERNS ═══",
      "// By ID (most specific)",
      "document.getElementById('username')",
      "document.querySelector('#username')",
      "",
      "// By class",
      "document.querySelector('.login-button')",
      "document.querySelectorAll('.product-card')",
      "",
      "// By attribute",
      "document.querySelector('[name=\"email\"]')",
      "document.querySelector('[data-testid=\"submit\"]')",
      "",
      "// By text content (use XPath or filter)",
      "Array.from(document.querySelectorAll('button'))",
      "  .find(btn => btn.textContent.includes('Submit'))",
      "",
      "═══ COMMON PATTERNS ═══",
      "",
      "**1. FORM FILLING**",
      "```javascript",
      "// Fill text input",
      "const input = document.querySelector('#email');",
      "if (input) {",
      "  input.value = 'user@example.com';",
      "  input.dispatchEvent(new Event('input', { bubbles: true }));",
      "}",
      "",
      "// Select dropdown option",
      "const select = document.querySelector('select[name=\"country\"]');",
      "if (select) {",
      "  select.value = 'US';",
      "  select.dispatchEvent(new Event('change', { bubbles: true }));",
      "}",
      "",
      "// Check checkbox",
      "const checkbox = document.querySelector('#agree');",
      "if (checkbox && !checkbox.checked) {",
      "  checkbox.click();",
      "}",
      "```",
      "",
      "**2. DATA EXTRACTION**",
      "```javascript",
      "// Extract table data",
      "const rows = Array.from(document.querySelectorAll('table tr'));",
      "const data = rows.map(row => {",
      "  const cells = row.querySelectorAll('td');",
      "  return Array.from(cells).map(cell => cell.textContent.trim());",
      "});",
      "return data;",
      "",
      "// Extract product information",
      "const products = Array.from(document.querySelectorAll('.product')).map(el => ({",
      "  name: el.querySelector('.title')?.textContent?.trim(),",
      "  price: el.querySelector('.price')?.textContent?.trim(),",
      "  image: el.querySelector('img')?.src",
      "}));",
      "return products;",
      "```",
      "",
      "**3. STYLE MODIFICATION**",
      "```javascript",
      "// Change colors (dark mode)",
      "document.body.style.backgroundColor = '#1a1a1a';",
      "document.body.style.color = '#ffffff';",
      "",
      "// Hide ads/distractions",
      "document.querySelectorAll('.ad, .sidebar, .popup').forEach(el => {",
      "  el.style.display = 'none';",
      "});",
      "",
      "// Highlight elements",
      "document.querySelectorAll('p').forEach(p => {",
      "  p.style.backgroundColor = 'yellow';",
      "  p.style.padding = '4px';",
      "});",
      "```",
      "",
      "**4. CONTENT MANIPULATION**",
      "```javascript",
      "// Replace text content",
      "document.querySelectorAll('h1').forEach(h1 => {",
      "  h1.textContent = h1.textContent.toUpperCase();",
      "});",
      "",
      "// Add new element",
      "const banner = document.createElement('div');",
      "banner.textContent = 'Important Notice';",
      "banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:red;color:white;padding:10px;text-align:center;z-index:9999';",
      "document.body.prepend(banner);",
      "```",
      "",
      "═══ AVAILABLE CONTEXT ═══",
    ];

    if (url) {
      parts.push(`📍 Current URL: ${url}`);
      
      // Add URL-specific hints
      if (url.includes('github.com')) {
        parts.push("💡 Hint: GitHub pages use data-testid attributes and semantic HTML");
      } else if (url.includes('reddit.com')) {
        parts.push("💡 Hint: Reddit uses data-click-id and specific class patterns");
      } else if (url.includes('twitter.com') || url.includes('x.com')) {
        parts.push("💡 Hint: Twitter/X uses data-testid extensively for element selection");
      }
    }

    // Add DOM structure insights if available
    if (domStructure) {
      parts.push(`\n🏗️  Page Structure:${domStructure}`);
    }

    if (pageText) {
      const truncatedText = this.truncateText(pageText, MAX_CONTEXT_LENGTH);
      parts.push(`\n📄 Page Content (text):\n${truncatedText}`);
      
      // Analyze page content for hints
      if (pageText.toLowerCase().includes('login') || pageText.toLowerCase().includes('sign in')) {
        parts.push("\n💡 Detected: Login/Sign-in form likely present");
      }
      if (pageText.toLowerCase().includes('search')) {
        parts.push("💡 Detected: Search functionality available");
      }
    }

    parts.push(
      "",
      "═══ RESPONSE FORMAT ═══",
      "1. **Brief Explanation** (1-2 sentences) - What the code does",
      "2. **JavaScript Code Block** - Complete, executable code:",
      "   ```javascript",
      "   // Your code here",
      "   ```",
      "3. **Notes** (optional) - Warnings, limitations, or alternatives",
      "",
      "═══ BEST PRACTICES ═══",
      "• Start with the most specific selector possible",
      "• Always check if elements exist before accessing them",
      "• Use optional chaining (?.) for safer property access",
      "• Dispatch events after modifying form inputs (for React/Vue apps)",
      "• Return meaningful data for extraction tasks",
      "• Return true for successful actions, false for failures",
      "• Wrap everything in an IIFE if needed: (async () => { ... })()",
      "",
      "Now, generate clean, working code based on the user's request!"
    );

    return parts.join("\n");
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  }

  private async streamResponse(
    messages: CoreMessage[],
    messageId: string
  ): Promise<void> {
    if (!this.model) {
      throw new Error("Model not initialized");
    }

    try {
      const result = await streamText({
        model: this.model,
        messages,
        temperature: DEFAULT_TEMPERATURE,
        maxRetries: 3,
        abortSignal: undefined, // Could add abort controller for cancellation
      });

      await this.processStream(result.textStream, messageId);
    } catch (error) {
      throw error; // Re-throw to be handled by the caller
    }
  }

  private async processStream(
    textStream: AsyncIterable<string>,
    messageId: string
  ): Promise<void> {
    let accumulatedText = "";

    // Create a placeholder assistant message
    const assistantMessage: CoreMessage = {
      role: "assistant",
      content: "",
    };
    
    // Keep track of the index for updates
    const messageIndex = this.messages.length;
    this.messages.push(assistantMessage);

    for await (const chunk of textStream) {
      accumulatedText += chunk;

      // Update assistant message content
      this.messages[messageIndex] = {
        role: "assistant",
        content: accumulatedText,
      };
      this.sendMessagesToRenderer();

      this.sendStreamChunk(messageId, {
        content: chunk,
        isComplete: false,
      });
    }

    // Final update with complete content
    this.messages[messageIndex] = {
      role: "assistant",
      content: accumulatedText,
    };
    this.sendMessagesToRenderer();

    // Send the final complete signal
    this.sendStreamChunk(messageId, {
      content: accumulatedText,
      isComplete: true,
    });
  }

  private handleStreamError(error: unknown, messageId: string): void {
    console.error("Error streaming from LLM:", error);

    const errorMessage = this.getErrorMessage(error);
    this.sendErrorMessage(messageId, errorMessage);
  }

  private getErrorMessage(error: unknown): string {
    if (!(error instanceof Error)) {
      return "An unexpected error occurred. Please try again.";
    }

    const message = error.message.toLowerCase();

    if (message.includes("401") || message.includes("unauthorized")) {
      return "Authentication error: Please check your API key in the .env file.";
    }

    if (message.includes("429") || message.includes("rate limit")) {
      return "Rate limit exceeded. Please try again in a few moments.";
    }

    if (
      message.includes("network") ||
      message.includes("fetch") ||
      message.includes("econnrefused")
    ) {
      return "Network error: Please check your internet connection.";
    }

    if (message.includes("timeout")) {
      return "Request timeout: The service took too long to respond. Please try again.";
    }

    return "Sorry, I encountered an error while processing your request. Please try again.";
  }

  private sendErrorMessage(messageId: string, errorMessage: string): void {
    this.sendStreamChunk(messageId, {
      content: errorMessage,
      isComplete: true,
    });
  }

  private sendStreamChunk(messageId: string, chunk: StreamChunk): void {
    this.webContents.send("chat-response", {
      messageId,
      content: chunk.content,
      isComplete: chunk.isComplete,
    });
  }
}
