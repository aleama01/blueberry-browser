import { NativeImage, WebContentsView } from "electron";

export interface ScriptExecutionOptions {
  timeout?: number;
  worldId?: number; // For isolated execution contexts
  returnRawResult?: boolean; // Return result without processing
}

export interface ScriptExecutionResult {
  success: boolean;
  result?: any;
  error?: string;
  executionTime: number;
}

export class Tab {
  private webContentsView: WebContentsView;
  private _id: string;
  private _title: string;
  private _url: string;
  private _isVisible: boolean = false;
  private scriptExecutionCount: number = 0;

  constructor(id: string, url: string = "https://www.google.com") {
    this._id = id;
    this._url = url;
    this._title = "New Tab";

    // Create the WebContentsView for web content only
    this.webContentsView = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });

    // Set up event listeners
    this.setupEventListeners();

    // Load the initial URL
    this.loadURL(url);
  }

  private setupEventListeners(): void {
    // Update title when page title changes
    this.webContentsView.webContents.on("page-title-updated", (_, title) => {
      this._title = title;
    });

    // Update URL when navigation occurs
    this.webContentsView.webContents.on("did-navigate", (_, url) => {
      this._url = url;
    });

    this.webContentsView.webContents.on("did-navigate-in-page", (_, url) => {
      this._url = url;
    });

    // Listen for console messages from injected scripts
    this.webContentsView.webContents.on("console-message", (_, level, message, line, sourceId) => {
      // Forward console messages to main process for debugging
      if (message.startsWith("[INJECTED_SCRIPT]")) {
        console.log(`Tab ${this._id} script:`, message.replace("[INJECTED_SCRIPT]", ""));
      }
    });
  }

  // Getters
  get id(): string {
    return this._id;
  }

  get title(): string {
    return this._title;
  }

  get url(): string {
    return this._url;
  }

  get isVisible(): boolean {
    return this._isVisible;
  }

  get webContents() {
    return this.webContentsView.webContents;
  }

  get view(): WebContentsView {
    return this.webContentsView;
  }

  // Public methods
  show(): void {
    this._isVisible = true;
    this.webContentsView.setVisible(true);
  }

  hide(): void {
    this._isVisible = false;
    this.webContentsView.setVisible(false);
  }

  async screenshot(): Promise<NativeImage> {
    return await this.webContentsView.webContents.capturePage();
  }

  /**
   * Execute JavaScript code in the page context
   * Legacy method - use executeScript for more features
   */
  async runJs(code: string): Promise<any> {
    return await this.webContentsView.webContents.executeJavaScript(code);
  }

  /**
   * Execute JavaScript with enhanced error handling and timeout
   */
  async executeScript(
    code: string,
    options: ScriptExecutionOptions = {}
  ): Promise<ScriptExecutionResult> {
    const startTime = Date.now();
    const timeout = options.timeout || 30000;
    const executionId = ++this.scriptExecutionCount;

    try {
      // Wrap the code in a safe execution context
      const wrappedCode = this.wrapScriptForExecution(code, executionId);

      // Execute with timeout
      const result = await this.executeWithTimeout(
        () => this.webContentsView.webContents.executeJavaScript(wrappedCode),
        timeout
      );

      const executionTime = Date.now() - startTime;

      // Check if result indicates an error
      if (result && typeof result === 'object' && result.__error) {
        return {
          success: false,
          error: result.message || 'Script execution failed',
          executionTime,
        };
      }

      return {
        success: true,
        result: options.returnRawResult ? result : this.processScriptResult(result),
        executionTime,
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTime,
      };
    }
  }

  /**
   * Wrap user script in error handling and logging
   */
  private wrapScriptForExecution(code: string, executionId: number): string {
    return `
(async function() {
  const __executionId = ${executionId};
  const __startTime = Date.now();
  
  // ═══════════════════════════════════════════════════════════
  // HELPER FUNCTIONS - Available to all injected scripts
  // ═══════════════════════════════════════════════════════════
  
  // Logging helper
  const log = (...args) => {
    console.log('[INJECTED_SCRIPT]', '[' + __executionId + ']', ...args);
  };
  
  // Safe query helpers
  const safeQuery = (selector) => {
    try {
      return document.querySelector(selector);
    } catch (e) {
      log('Query failed:', selector, e.message);
      return null;
    }
  };
  
  const safeQueryAll = (selector) => {
    try {
      return Array.from(document.querySelectorAll(selector));
    } catch (e) {
      log('QueryAll failed:', selector, e.message);
      return [];
    }
  };
  
  // Wait for element helper
  const waitFor = (selector, timeout = 10000) => {
    return new Promise((resolve) => {
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
        return;
      }
      
      const observer = new MutationObserver(() => {
        const element = document.querySelector(selector);
        if (element) {
          observer.disconnect();
          resolve(element);
        }
      });
      
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
      
      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  };
  
  // Check element visibility
  const isVisible = (element) => {
    if (!element || !(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      element.offsetParent !== null
    );
  };
  
  // Set input value (React/Vue compatible)
  const setInputValue = (input, value) => {
    if (!input) return false;
    
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;
    
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(input, value);
    } else {
      input.value = value;
    }
    
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };
  
  // Fill form helper
  const fillForm = (data, formSelector) => {
    let filled = 0;
    const form = formSelector ? document.querySelector(formSelector) : document;
    if (!form) return 0;
    
    for (const [name, value] of Object.entries(data)) {
      let input = form.querySelector(\`[name="\${name}"]\`);
      if (!input) input = form.querySelector(\`#\${name}\`);
      if (!input) continue;
      
      try {
        if (input.type === 'checkbox') {
          if (input.checked !== Boolean(value)) {
            input.click();
          }
          filled++;
        } else if (input.type === 'radio') {
          if (input.value === value && !input.checked) {
            input.click();
            filled++;
          }
        } else if (input.tagName === 'SELECT') {
          input.value = String(value);
          input.dispatchEvent(new Event('change', { bubbles: true }));
          filled++;
        } else {
          setInputValue(input, String(value));
          filled++;
        }
      } catch (e) {
        log('Failed to fill field:', name, e.message);
      }
    }
    
    return filled;
  };
  
  // Extract table data
  const extractTable = (selector) => {
    const table = document.querySelector(selector);
    if (!table) return [];
    
    const rows = Array.from(table.querySelectorAll('tr'));
    return rows.map(row => {
      const cells = Array.from(row.querySelectorAll('td, th'));
      return cells.map(cell => cell.textContent?.trim() || '');
    });
  };
  
  // Extract links
  const extractLinks = (containerSelector) => {
    const container = containerSelector ? document.querySelector(containerSelector) : document;
    if (!container) return [];
    
    const links = Array.from(container.querySelectorAll('a'));
    return links.map(link => ({
      text: link.textContent?.trim() || '',
      href: link.href,
    }));
  };
  
  // Click element helper
  const click = (selector) => {
    const element = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!element) return false;
    element.click();
    return true;
  };
  
  // Hide/show helpers
  const hide = (selector) => {
    const elements = safeQueryAll(selector);
    elements.forEach(el => el.style.display = 'none');
    return elements.length;
  };
  
  const show = (selector, display = 'block') => {
    const elements = safeQueryAll(selector);
    elements.forEach(el => el.style.display = display);
    return elements.length;
  };
  
  // Apply styles helper
  const setStyles = (selector, styles) => {
    const elements = typeof selector === 'string' ? safeQueryAll(selector) : [selector];
    elements.forEach(el => {
      if (el instanceof HTMLElement) {
        for (const [prop, value] of Object.entries(styles)) {
          el.style.setProperty(prop, value);
        }
      }
    });
    return elements.length;
  };
  
  // ═══════════════════════════════════════════════════════════
  // USER SCRIPT STARTS HERE
  // ═══════════════════════════════════════════════════════════
  
  try {
    const result = await (async function() {
      ${code}
    })();
    // USER SCRIPT ENDS HERE
    
    const __executionTime = Date.now() - __startTime;
    log('Execution completed in', __executionTime, 'ms');
    
    return result;
  } catch (error) {
    log('Error:', error.message);
    return {
      __error: true,
      message: error.message,
      stack: error.stack,
      name: error.name
    };
  }
})();
    `.trim();
  }

  /**
   * Process and sanitize script results
   */
  private processScriptResult(result: any): any {
    // Handle null/undefined
    if (result === null || result === undefined) {
      return result;
    }

    // Handle primitives
    if (typeof result !== 'object') {
      return result;
    }

    // Handle arrays
    if (Array.isArray(result)) {
      return result.map(item => this.processScriptResult(item));
    }

    // Handle objects - remove non-serializable properties
    const processed: any = {};
    for (const [key, value] of Object.entries(result)) {
      // Skip functions and symbols
      if (typeof value === 'function' || typeof value === 'symbol') {
        continue;
      }
      
      // Skip DOM nodes (can't be serialized)
      if (value instanceof Node) {
        processed[key] = '[DOM Node]';
        continue;
      }

      // Recursively process nested objects
      if (typeof value === 'object' && value !== null) {
        processed[key] = this.processScriptResult(value);
      } else {
        processed[key] = value;
      }
    }

    return processed;
  }

  /**
   * Execute function with timeout
   */
  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeout: number
  ): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Execution timeout after ${timeout}ms`)), timeout)
      ),
    ]);
  }

  /**
   * Inject a persistent script that runs on page load
   */
  async injectPersistentScript(code: string): Promise<void> {
    // This will run on every page load in this tab
    await this.webContentsView.webContents.executeJavaScript(`
      (function() {
        // Store the script to re-inject on navigation
        if (!window.__persistentScripts) {
          window.__persistentScripts = [];
        }
        
        const script = ${JSON.stringify(code)};
        window.__persistentScripts.push(script);
        
        // Execute the script
        try {
          eval(script);
        } catch (error) {
          console.error('[PERSISTENT_SCRIPT] Error:', error);
        }
      })();
    `);
  }

  /**
   * Clear all persistent scripts
   */
  async clearPersistentScripts(): Promise<void> {
    await this.webContentsView.webContents.executeJavaScript(`
      if (window.__persistentScripts) {
        window.__persistentScripts = [];
      }
    `);
  }

  /**
   * Check if page is ready for script execution
   */
  async isPageReady(): Promise<boolean> {
    try {
      const state = await this.webContentsView.webContents.executeJavaScript(
        'document.readyState'
      );
      return state === 'complete' || state === 'interactive';
    } catch {
      return false;
    }
  }

  /**
   * Wait for page to be ready
   */
  async waitForPageReady(timeout: number = 10000): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      if (await this.isPageReady()) {
        return true;
      }
      // Wait 100ms before checking again
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return false;
  }

  async getTabHtml(): Promise<string> {
    return await this.runJs("document.documentElement");
  }

  async getTabText(): Promise<string> {
    return await this.runJs("document.documentElement.innerText");
  }

  loadURL(url: string): Promise<void> {
    this._url = url;
    return this.webContentsView.webContents.loadURL(url);
  }

  goBack(): void {
    if (this.webContentsView.webContents.navigationHistory.canGoBack()) {
      this.webContentsView.webContents.navigationHistory.goBack();
    }
  }

  goForward(): void {
    if (this.webContentsView.webContents.navigationHistory.canGoForward()) {
      this.webContentsView.webContents.navigationHistory.goForward();
    }
  }

  reload(): void {
    this.webContentsView.webContents.reload();
  }

  stop(): void {
    this.webContentsView.webContents.stop();
  }

  destroy(): void {
    this.webContentsView.webContents.close();
  }
}
