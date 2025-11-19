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
  openai: "gpt-4.1-nano",
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
      console.log("Prepared Messages:\n", messages);
      await this.streamResponse(messages, request.messageId, request);
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
   * Get comprehensive DOM structure and element hints for the coding agent.
   * Provides actionable selectors, accessibility info, and code generation guidance.
   */
  private async getDOMStructureHints(tab: any): Promise<string> {
    try {
      const hints = await tab.runJs(`
        (function() {
          const result = {
            pageInfo: {},
            semantic: {},
            interactive: {},
            frameworks: [],
            selectors: {}
          };

          // ═══════════════════════════════════════════════════════════
          // PAGE INFO - Basic page structure and metadata
          // ═══════════════════════════════════════════════════════════
          result.pageInfo = {
            title: document.title || 'Untitled',
            lang: document.documentElement.lang || 'unknown',
            hasViewport: !!document.querySelector('meta[name="viewport"]'),
            bodyClasses: Array.from(document.body.classList).slice(0, 3),
            documentHeight: document.documentElement.scrollHeight,
            viewportHeight: window.innerHeight
          };

          // ═══════════════════════════════════════════════════════════
          // FRAMEWORK DETECTION - Identify libraries and frameworks
          // ═══════════════════════════════════════════════════════════
          if (window.React || document.querySelector('[data-reactroot], [data-reactid]')) {
            result.frameworks.push('React');
          }
          if (window.Vue || document.querySelector('[data-v-]')) {
            result.frameworks.push('Vue');
          }
          if (window.angular || document.querySelector('[ng-app], [ng-controller]')) {
            result.frameworks.push('Angular');
          }
          if (window.jQuery || window.$) {
            result.frameworks.push('jQuery v' + (window.$ && window.$.fn && window.$.fn.jquery || 'unknown'));
          }

          // ═══════════════════════════════════════════════════════════
          // HELPER: Build multiple selector strategies for an element
          // ═══════════════════════════════════════════════════════════
          function buildSelectors(el) {
            const selectors = [];
            
            // Strategy 1: ID (most reliable, highest priority)
            if (el.id) {
              selectors.push({
                type: 'id',
                selector: '#' + CSS.escape(el.id),
                reliability: 'high',
                code: \`document.querySelector('#\${CSS.escape(el.id)}')\`
              });
            }
            
            // Strategy 2: Name attribute (forms)
            if (el.name) {
              selectors.push({
                type: 'name',
                selector: '[name="' + el.name + '"]',
                reliability: 'high',
                code: \`document.querySelector('[name="\${el.name}"]')\`
              });
            }
            
            // Strategy 3: Data attributes (modern apps)
            const dataAttrs = Array.from(el.attributes).filter(a => a.name.startsWith('data-'));
            if (dataAttrs.length > 0) {
              const attr = dataAttrs[0];
              selectors.push({
                type: 'data-attribute',
                selector: '[' + attr.name + '="' + attr.value + '"]',
                reliability: 'medium-high',
                code: \`document.querySelector('[\${attr.name}="\${attr.value}"]')\`
              });
            }
            
            // Strategy 4: ARIA labels (accessibility-first)
            const ariaLabel = el.getAttribute('aria-label');
            if (ariaLabel) {
              selectors.push({
                type: 'aria-label',
                selector: '[aria-label="' + ariaLabel + '"]',
                reliability: 'medium',
                code: \`document.querySelector('[aria-label="\${ariaLabel}"]')\`
              });
            }
            
            // Strategy 5: Placeholder (inputs)
            if (el.placeholder) {
              selectors.push({
                type: 'placeholder',
                selector: '[placeholder="' + el.placeholder + '"]',
                reliability: 'medium',
                code: \`document.querySelector('[placeholder="\${el.placeholder}"]')\`
              });
            }
            
            // Strategy 6: Test IDs (common in modern frameworks)
            const testId = el.getAttribute('data-testid') || el.getAttribute('data-test-id') || el.getAttribute('data-cy');
            if (testId) {
              const attrName = el.getAttribute('data-testid') ? 'data-testid' : 
                             el.getAttribute('data-test-id') ? 'data-test-id' : 'data-cy';
              selectors.push({
                type: 'test-id',
                selector: '[' + attrName + '="' + testId + '"]',
                reliability: 'high',
                code: \`document.querySelector('[\${attrName}="\${testId}"]')\`
              });
            }
            
            // Strategy 7: Classes (less reliable but useful)
            if (el.className && typeof el.className === 'string') {
              const classes = el.className.trim().split(/\\s+/).filter(c => c && !c.match(/^(css-|_)/));
              if (classes.length > 0) {
                const classStr = classes.slice(0, 2).join('.');
                selectors.push({
                  type: 'class',
                  selector: el.tagName.toLowerCase() + '.' + classStr,
                  reliability: 'low-medium',
                  code: \`document.querySelector('\${el.tagName.toLowerCase()}.\${classStr}')\`
                });
              }
            }
            
            // Strategy 8: XPath for complex hierarchies
            function getXPath(element) {
              if (element.id) return '//*[@id="' + element.id + '"]';
              if (element === document.body) return '/html/body';
              
              let ix = 0;
              const siblings = element.parentNode ? element.parentNode.childNodes : [];
              for (let i = 0; i < siblings.length; i++) {
                const sibling = siblings[i];
                if (sibling === element) {
                  const parentPath = element.parentNode ? getXPath(element.parentNode) : '';
                  return parentPath + '/' + element.tagName.toLowerCase() + '[' + (ix + 1) + ']';
                }
                if (sibling.nodeType === 1 && sibling.tagName === element.tagName) {
                  ix++;
                }
              }
            }
            
            const xpath = getXPath(el);
            if (xpath) {
              selectors.push({
                type: 'xpath',
                selector: xpath,
                reliability: 'high',
                code: \`document.evaluate("\${xpath}", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue\`
              });
            }
            
            return selectors;
          }

          // ═══════════════════════════════════════════════════════════
          // HELPER: Get semantic context (parent structure)
          // ═══════════════════════════════════════════════════════════
          function getContext(el) {
            const contexts = [];
            let parent = el.parentElement;
            let depth = 0;
            
            while (parent && depth < 5) {
              const tag = parent.tagName.toLowerCase();
              
              // Semantic containers
              if (['form', 'header', 'footer', 'nav', 'main', 'aside', 'section', 'article'].includes(tag)) {
                const id = parent.id ? '#' + parent.id : '';
                const role = parent.getAttribute('role') || '';
                contexts.push({
                  tag: tag,
                  id: id,
                  role: role,
                  depth: depth
                });
              }
              
              // ARIA landmarks
              if (parent.getAttribute('role')) {
                contexts.push({
                  tag: tag,
                  role: parent.getAttribute('role'),
                  depth: depth
                });
              }
              
              parent = parent.parentElement;
              depth++;
            }
            
            return contexts;
          }

          // ═══════════════════════════════════════════════════════════
          // HELPER: Extract compact HTML for reference
          // ═══════════════════════════════════════════════════════════
          function getCompactHTML(el, maxLength = 400) {
            let html = el.outerHTML;
            
            // For elements with children, just show opening tag
            if (el.children.length > 0) {
              const match = html.match(/^<[^>]+>/);
              return match ? match[0] : html.substring(0, maxLength);
            }
            
            // For leaf elements, show full HTML but truncate if needed
            if (html.length > maxLength) {
              return html.substring(0, maxLength) + '...';
            }
            
            return html;
          }

          // ═══════════════════════════════════════════════════════════
          // SEMANTIC ELEMENTS - Page structure and navigation
          // ═══════════════════════════════════════════════════════════
          result.semantic.landmarks = Array.from(
            document.querySelectorAll('main, nav, header, footer, aside, [role="main"], [role="navigation"], [role="banner"], [role="contentinfo"]')
          ).slice(0, 8).map(el => ({
            tag: el.tagName.toLowerCase(),
            role: el.getAttribute('role'),
            id: el.id || null,
            selectors: buildSelectors(el).slice(0, 3),
            html: getCompactHTML(el, 200)
          }));

          result.semantic.headings = Array.from(
            document.querySelectorAll('h1, h2, h3, h4, h5, h6')
          ).slice(0, 12).map(h => ({
            level: h.tagName.toLowerCase(),
            text: h.textContent.trim().substring(0, 80),
            id: h.id || null,
            selectors: buildSelectors(h).slice(0, 2)
          }));

          result.semantic.links = Array.from(
            document.querySelectorAll('a[href]')
          ).slice(0, 20).map(a => ({
            text: a.textContent.trim().substring(0, 50),
            href: a.href,
            target: a.target || null,
            rel: a.rel || null,
            selectors: buildSelectors(a).slice(0, 2)
          }));

          // ═══════════════════════════════════════════════════════════
          // INTERACTIVE ELEMENTS - Forms, inputs, buttons
          // ═══════════════════════════════════════════════════════════
          
          // Forms
          result.interactive.forms = Array.from(document.querySelectorAll('form')).slice(0, 5).map((form, idx) => {
            const fields = form.querySelectorAll('input, textarea, select, button');
            return {
              index: idx,
              action: form.action || null,
              method: form.method || 'GET',
              fieldCount: fields.length,
              selectors: buildSelectors(form),
              context: getContext(form),
              html: getCompactHTML(form, 300)
            };
          });

          // Inputs & Textareas
          result.interactive.inputs = Array.from(
            document.querySelectorAll('input:not([type="hidden"]), textarea')
          ).slice(0, 20).map((input, idx) => {
            const label = input.labels && input.labels[0] ? input.labels[0].textContent.trim() : 
                         input.getAttribute('aria-label') || 
                         input.getAttribute('placeholder') || null;
            
            return {
              index: idx,
              tag: input.tagName.toLowerCase(),
              type: input.type || 'text',
              label: label,
              name: input.name || null,
              value: input.value ? '***' : null, // Don't leak sensitive data
              required: input.required || input.getAttribute('aria-required') === 'true',
              disabled: input.disabled,
              selectors: buildSelectors(input),
              context: getContext(input),
              html: getCompactHTML(input)
            };
          });

          // Buttons & Clickable elements
          result.interactive.buttons = Array.from(
            document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"], a.btn, a.button')
          ).slice(0, 15).map((btn, idx) => {
            const text = btn.textContent ? btn.textContent.trim() : 
                        btn.value || 
                        btn.getAttribute('aria-label') || 
                        btn.getAttribute('title') || '';
            
            return {
              index: idx,
              tag: btn.tagName.toLowerCase(),
              type: btn.type || null,
              text: text.substring(0, 60),
              disabled: btn.disabled || btn.getAttribute('aria-disabled') === 'true',
              selectors: buildSelectors(btn),
              context: getContext(btn),
              html: getCompactHTML(btn, 300)
            };
          });

          // Select dropdowns
          result.interactive.selects = Array.from(document.querySelectorAll('select')).slice(0, 10).map((select, idx) => {
            const label = select.labels && select.labels[0] ? select.labels[0].textContent.trim() : 
                         select.getAttribute('aria-label') || null;
            
            const options = Array.from(select.options).slice(0, 5).map(opt => ({
              value: opt.value,
              text: opt.textContent.trim(),
              selected: opt.selected
            }));
            
            return {
              index: idx,
              label: label,
              name: select.name || null,
              optionCount: select.options.length,
              options: options,
              required: select.required,
              selectors: buildSelectors(select),
              context: getContext(select),
              html: getCompactHTML(select, 400)
            };
          });

          // Checkboxes & Radios
          result.interactive.checkboxesRadios = Array.from(
            document.querySelectorAll('input[type="checkbox"], input[type="radio"]')
          ).slice(0, 15).map((input, idx) => {
            const label = input.labels && input.labels[0] ? input.labels[0].textContent.trim() : 
                         input.getAttribute('aria-label') || null;
            
            return {
              index: idx,
              type: input.type,
              name: input.name || null,
              value: input.value || null,
              checked: input.checked,
              label: label,
              selectors: buildSelectors(input),
              html: getCompactHTML(input)
            };
          });

          // ═══════════════════════════════════════════════════════════
          // COMMON SELECTOR PATTERNS - Pre-built queries
          // ═══════════════════════════════════════════════════════════
          result.selectors.byId = Array.from(new Set(
            Array.from(document.querySelectorAll('[id]')).map(el => el.id).filter(id => id)
          )).slice(0, 30);

          result.selectors.byDataTestId = Array.from(new Set(
            Array.from(document.querySelectorAll('[data-testid], [data-test-id], [data-cy]')).map(el => 
              el.getAttribute('data-testid') || el.getAttribute('data-test-id') || el.getAttribute('data-cy')
            ).filter(id => id)
          )).slice(0, 20);

          result.selectors.byAriaLabel = Array.from(new Set(
            Array.from(document.querySelectorAll('[aria-label]')).map(el => el.getAttribute('aria-label')).filter(l => l)
          )).slice(0, 20);

          return result;
        })();
      `);

      // Format the output for the LLM
      const output: string[] = [];
      
      // Page overview
      output.push('═══════════════════════════════════════════════════════');
      output.push('PAGE STRUCTURE & ELEMENT REFERENCE');
      output.push('═══════════════════════════════════════════════════════');
      output.push(`Title: ${hints.pageInfo.title}`);
      output.push(`Language: ${hints.pageInfo.lang}`);
      if (hints.frameworks.length > 0) {
        output.push(`Frameworks: ${hints.frameworks.join(', ')}`);
      }
      output.push('');

      // Semantic structure
      if (hints.semantic.landmarks && hints.semantic.landmarks.length > 0) {
        output.push('LANDMARKS & SEMANTIC STRUCTURE');
        output.push('Use these to navigate and scope your queries:');
        hints.semantic.landmarks.forEach((landmark: any) => {
          const idInfo = landmark.id ? ` id="${landmark.id}"` : '';
          const roleInfo = landmark.role ? ` role="${landmark.role}"` : '';
          output.push(`  <${landmark.tag}${idInfo}${roleInfo}>`);
          if (landmark.selectors && landmark.selectors.length > 0) {
            output.push(`    Primary: ${landmark.selectors[0].code}`);
          }
        });
        output.push('');
      }

      // Forms
      if (hints.interactive.forms && hints.interactive.forms.length > 0) {
        output.push('FORMS (' + hints.interactive.forms.length + ' found)');
        hints.interactive.forms.forEach((form: any, idx: number) => {
          output.push(`  Form #${idx + 1}: ${form.fieldCount} fields, method=${form.method}`);
          if (form.selectors && form.selectors.length > 0) {
            output.push(`    Best selector: ${form.selectors[0].code}`);
            if (form.selectors.length > 1) {
              output.push(`    Alternative: ${form.selectors[1].code}`);
            }
          }
          output.push(`    HTML: ${form.html}`);
        });
        output.push('');
      }

      // Inputs
      if (hints.interactive.inputs && hints.interactive.inputs.length > 0) {
        output.push('INPUTS & TEXTAREAS (' + hints.interactive.inputs.length + ' found)');
        hints.interactive.inputs.forEach((input: any, idx: number) => {
          const labelInfo = input.label ? ` "${input.label}"` : '';
          const typeInfo = input.type !== 'text' ? ` [${input.type}]` : '';
          const reqInfo = input.required ? ' *required*' : '';
          output.push(`  Input #${idx + 1}:${labelInfo}${typeInfo}${reqInfo}`);
          
          if (input.selectors && input.selectors.length > 0) {
            // Show top 2 selector strategies
            input.selectors.slice(0, 2).forEach((sel: any) => {
              output.push(`    ${sel.type} (${sel.reliability}): ${sel.code}`);
            });
          }
          output.push(`    HTML: ${input.html}`);
        });
        output.push('');
      }

      // Buttons
      if (hints.interactive.buttons && hints.interactive.buttons.length > 0) {
        output.push('BUTTONS & CLICKABLE ELEMENTS (' + hints.interactive.buttons.length + ' found)');
        hints.interactive.buttons.forEach((btn: any, idx: number) => {
          const disabledInfo = btn.disabled ? ' [DISABLED]' : '';
          output.push(`  Button #${idx + 1}: "${btn.text}"${disabledInfo}`);
          
          if (btn.selectors && btn.selectors.length > 0) {
            // Show top 2 selector strategies
            btn.selectors.slice(0, 2).forEach((sel: any) => {
              output.push(`    ${sel.type} (${sel.reliability}): ${sel.code}`);
            });
          }
          output.push(`    HTML: ${btn.html}`);
        });
        output.push('');
      }

      // Selects
      if (hints.interactive.selects && hints.interactive.selects.length > 0) {
        output.push('SELECT DROPDOWNS (' + hints.interactive.selects.length + ' found)');
        hints.interactive.selects.forEach((select: any, idx: number) => {
          const labelInfo = select.label ? ` "${select.label}"` : '';
          output.push(`  Select #${idx + 1}:${labelInfo} (${select.optionCount} options)`);
          
          if (select.options && select.options.length > 0) {
            output.push(`    Options: ${select.options.map((o: any) => o.text).join(', ')}`);
          }
          
          if (select.selectors && select.selectors.length > 0) {
            output.push(`    Best selector: ${select.selectors[0].code}`);
          }
          output.push(`    HTML: ${select.html}`);
        });
        output.push('');
      }

      // Checkboxes & Radios
      if (hints.interactive.checkboxesRadios && hints.interactive.checkboxesRadios.length > 0) {
        output.push('CHECKBOXES & RADIOS (' + hints.interactive.checkboxesRadios.length + ' found)');
        hints.interactive.checkboxesRadios.forEach((input: any, idx: number) => {
          const labelInfo = input.label ? ` "${input.label}"` : '';
          const checkedInfo = input.checked ? ' ✓' : '';
          output.push(`  ${input.type} #${idx + 1}:${labelInfo}${checkedInfo}`);
          
          if (input.selectors && input.selectors.length > 0) {
            output.push(`    Selector: ${input.selectors[0].code}`);
          }
        });
        output.push('');
      }

      // Quick reference lists
      if (hints.selectors.byId && hints.selectors.byId.length > 0) {
        output.push('QUICK REFERENCE: IDs');
        output.push(`  Available IDs: ${hints.selectors.byId.slice(0, 15).join(', ')}`);
        output.push('');
      }

      if (hints.selectors.byDataTestId && hints.selectors.byDataTestId.length > 0) {
        output.push('QUICK REFERENCE: Test IDs');
        output.push(`  Available test IDs: ${hints.selectors.byDataTestId.slice(0, 10).join(', ')}`);
        output.push('');
      }

      // Code generation guidance
      output.push('CODE GENERATION TIPS');
      output.push('1. Prefer selectors with "high" reliability (ID, name, test-id, xpath)');
      output.push('2. Use the exact code snippets provided above');
      output.push('3. Add null checks: const el = document.querySelector(...); if (!el) return;');
      output.push('4. For forms, use fillForm() helper with name/ID-based field mapping');
      output.push('5. For clicks, use click() helper which handles both selector strings and elements');
      output.push('6. Combine selectors when needed: form.querySelector(\'input[name="email"]\')');

      return output.join('\n');
      
    } catch (error) {
      console.error('Failed to analyze DOM structure:', error);
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
    }else{
      return this.buildChatSystemPrompt(url, pageText);
    }
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
      "═══ VISUAL CONTEXT ═══",
      "The user's messages include a screenshot of the current page as the first image.",
      "Use the screenshot alongside the following page context to inform your code generation.",
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
      "✓ Return a value (data extraction) or indicate success (true/false)",
      "✓ Handle errors gracefully with try-catch",
      "✓ Use specific selectors (IDs, classes, data attributes) taken from the page structure or screenshot",
      "✓ Add null checks before accessing properties",
      "✗ Do NOT use require(), import, or Node.js APIs",
      "✗ Do NOT use external libraries (jQuery, etc.) unless already on page",
      "✗ Do NOT make dangerous modifications without user request",
      "",
      "═══ AVAILABLE CONTEXT ═══",
    ];
    /*
    if (url) {
      parts.push(`\nCurrent page URL: ${url}`);
    }
    
    */
    // Add DOM structure insights if available
    if (domStructure) {
      parts.push(`\n Page Structure: ${domStructure}`);
    }
    /* 
    if (pageText) {
      const truncatedText = this.truncateText(pageText, MAX_CONTEXT_LENGTH);
      parts.push(`\n Page Content (text):\n${truncatedText}`);
      
      // Analyze page content for hints
      if (pageText.toLowerCase().includes('login') || pageText.toLowerCase().includes('sign in')) {
        parts.push("\n Detected: Login/Sign-in form likely present");
      }
      if (pageText.toLowerCase().includes('search')) {
        parts.push(" Detected: Search functionality available");
      }
    }
    */
    
    parts.push(
      "",
      "═══ RESPONSE FORMAT ═══",
      "1. **Brief Explanation** (1-2 sentences) - What the code does",
      "2. **JavaScript Code Block** - Complete, executable code, using DOM structure references to access elements:",
      "   ```javascript",
      "   // Your code here",
      "   ```",
      "3. **Notes** (optional) - Warnings, limitations, or alternatives",
      "",
      "═══ AVAILABLE HELPER FUNCTIONS ═══",
      "Your scripts run in an enhanced execution context with 20+ helper functions.",
      "These are injected automatically - use them directly without importing!",
      "",
      "**DEBUGGING**",
      "  log(...args) - Tagged console logging",
      "    Example: log('Found', items.length, 'items');",
      "",
      "**DOM SELECTION**",
      "  safeQuery(selector) - Safe querySelector (returns null on error)",
      "    Example: const btn = safeQuery('#submit-button');",
      "",
      "  safeQueryAll(selector) - Safe querySelectorAll (returns [] on error)",
      "    Example: const items = safeQueryAll('.product-item');",
      "",
      "  waitFor(selector, timeout=10000) - Wait for element to appear",
      "    Example: const modal = await waitFor('.modal', 5000);",
      "",
      "  isVisible(element) - Check if element is visible (not hidden, opacity, display)",
      "    Example: if (isVisible(popup)) { popup.remove(); }",
      "",
      "**FORM HELPERS**",
      "  setInputValue(input, value) - Set input value (React/Vue compatible)",
      "    Dispatches input/change events automatically",
      "    Example: setInputValue(emailInput, 'user@example.com');",
      "",
      "  fillForm(data, formSelector?) - Fill multiple form fields at once",
      "    Returns count of filled fields. Handles inputs, checkboxes, radios, selects",
      "    Example: fillForm({ name: 'John', email: 'john@example.com', agree: true });",
      "    Example: fillForm({ country: 'US' }, '#checkout-form');",
      "",
      "**DATA EXTRACTION**",
      "  extractTable(selector) - Extract all table data as 2D array",
      "    Example: const data = extractTable('table.results');",
      "    Returns: [['Header1', 'Header2'], ['Row1Col1', 'Row1Col2'], ...]",
      "",
      "  extractLinks(containerSelector?) - Extract all links from container",
      "    Example: const links = extractLinks('.article');",
      "    Returns: [{ text: 'Click here', href: 'https://...' }, ...]",
      "",
      "**INTERACTION**",
      "  click(selector) - Click element by selector or element reference",
      "    Returns true if clicked, false if not found",
      "    Example: click('.accept-cookies');",
      "    Example: click(button);",
      "",
      "**STYLING**",
      "  hide(selector) - Hide elements (sets display: none)",
      "    Returns count of hidden elements",
      "    Example: hide('.advertisement, .popup');",
      "",
      "  show(selector, display='block') - Show elements",
      "    Returns count of shown elements",
      "    Example: show('.hidden-content', 'flex');",
      "",
      "  setStyles(selector, styles) - Apply multiple CSS properties",
      "    Example: setStyles('.highlight', { backgroundColor: 'yellow', padding: '4px' });",
      "    Example: setStyles(element, { fontSize: '18px', color: '#333' });",
      ""
    );

    return parts.join("\n");
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  }

  private async streamResponse(
    messages: CoreMessage[],
    messageId: string,
    request: ChatRequest
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

      await this.processStream(result.textStream, messageId, request);
    } catch (error) {
      throw error; // Re-throw to be handled by the caller
    }
  }

  private async processStream(
    textStream: AsyncIterable<string>,
    messageId: string,
    request: ChatRequest
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

    // Auto-extract and create script if in agent mode
    if (request.mode === 'agent') {
      await this.handleAgentResponse(accumulatedText, request.message);
    }
  }

  /**
   * Handle agent mode responses by auto-extracting and creating scripts
   */
  private async handleAgentResponse(
    response: string,
    userMessage: string
  ): Promise<void> {
    if (!this.window) {
      console.warn('Cannot handle agent response: window not set');
      return;
    }

    const sidebar = this.window.sidebar;
    if (!sidebar?.scripts) {
      console.warn('Cannot handle agent response: sidebar or scripts not available');
      return;
    }

    const scriptManager = sidebar.scripts;

    try {
      // Auto-extract JavaScript code from the LLM response
      const script = scriptManager.autoExtractAndAddScript(
        response,
        `Agent task: ${userMessage.substring(0, 100)}${userMessage.length > 100 ? '...' : ''}`
      );

      if (script) {
        console.log(`✅ Auto-extracted script: ${script.id}`);
      } else {
        console.log('No JavaScript code blocks found in agent response');
      }
    } catch (error) {
      console.error('Failed to auto-extract script from agent response:', error);
    }
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
