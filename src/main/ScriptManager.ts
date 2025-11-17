import { WebContents } from "electron";
import type { Window } from "./Window";

export interface Script {
  id: string;
  code: string;
  description?: string;
  createdAt: number;
  status: 'pending' | 'approved' | 'running' | 'completed' | 'failed';
  result?: any;
  error?: string;
  tabId?: string;
  executionTime?: number;
}

export interface ScriptExecutionRequest {
  scriptId: string;
  tabId?: string; // Optional: if not provided, use active tab
}

export interface ScriptExecutionResult {
  scriptId: string;
  success: boolean;
  result?: any;
  error?: string;
  executionTime: number;
}

const SCRIPT_TIMEOUT = 30000; // 30 seconds max execution time
const MAX_SCRIPT_LENGTH = 50000; // 50KB max script size

export class ScriptManager {
  private readonly sidebarWebContents: WebContents;
  private window: Window | null = null;
  private scripts: Map<string, Script> = new Map();

  constructor(sidebarWebContents: WebContents) {
    this.sidebarWebContents = sidebarWebContents;
  }

  // Set the window reference after construction to avoid circular dependencies
  setWindow(window: Window): void {
    this.window = window;
  }

  /**
   * Store a script for later execution
   */
  addScript(code: string, description?: string): Script {
    const script: Script = {
      id: this.generateScriptId(),
      code,
      description,
      createdAt: Date.now(),
      status: 'pending',
    };

    // Validate script before storing
    const validation = this.validateScript(code);
    if (!validation.valid) {
      script.status = 'failed';
      script.error = validation.error;
    }

    this.scripts.set(script.id, script);
    this.notifyScriptUpdate(script);

    return script;
  }

  /**
   * Get a script by ID
   */
  getScript(scriptId: string): Script | undefined {
    return this.scripts.get(scriptId);
  }

  /**
   * Get all scripts
   */
  getAllScripts(): Script[] {
    return Array.from(this.scripts.values());
  }

  /**
   * Approve a script for execution (security check)
   */
  approveScript(scriptId: string): boolean {
    const script = this.scripts.get(scriptId);
    if (!script || script.status !== 'pending') {
      return false;
    }

    script.status = 'approved';
    this.scripts.set(scriptId, script);
    this.notifyScriptUpdate(script);

    return true;
  }

  /**
   * Execute a script on a specific tab or the active tab
   */
  async executeScript(request: ScriptExecutionRequest): Promise<ScriptExecutionResult> {
    const script = this.scripts.get(request.scriptId);
    
    if (!script) {
      return {
        scriptId: request.scriptId,
        success: false,
        error: 'Script not found',
        executionTime: 0,
      };
    }

    if (script.status === 'failed') {
      return {
        scriptId: request.scriptId,
        success: false,
        error: script.error || 'Script validation failed',
        executionTime: 0,
      };
    }

    // Get the target tab
    const tab = request.tabId 
      ? this.window?.getTab(request.tabId)
      : this.window?.activeTab;

    if (!tab) {
      return {
        scriptId: request.scriptId,
        success: false,
        error: 'No active tab found',
        executionTime: 0,
      };
    }

    // Update script status
    script.status = 'running';
    script.tabId = tab.id;
    this.scripts.set(request.scriptId, script);
    this.notifyScriptUpdate(script);

    try {
      // Use the enhanced executeScript method from Tab
      const executionResult = await tab.executeScript(script.code, {
        timeout: SCRIPT_TIMEOUT,
        returnRawResult: false,
      });

      // Update script with result
      if (executionResult.success) {
        script.status = 'completed';
        script.result = executionResult.result;
        script.executionTime = executionResult.executionTime;
      } else {
        script.status = 'failed';
        script.error = executionResult.error;
        script.executionTime = executionResult.executionTime;
      }
      
      this.scripts.set(request.scriptId, script);
      this.notifyScriptUpdate(script);

      return {
        scriptId: request.scriptId,
        success: executionResult.success,
        result: executionResult.result,
        error: executionResult.error,
        executionTime: executionResult.executionTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Update script with error
      script.status = 'failed';
      script.error = errorMessage;
      this.scripts.set(request.scriptId, script);
      this.notifyScriptUpdate(script);

      return {
        scriptId: request.scriptId,
        success: false,
        error: errorMessage,
        executionTime: 0,
      };
    }
  }

  /**
   * Delete a script
   */
  deleteScript(scriptId: string): boolean {
    const deleted = this.scripts.delete(scriptId);
    if (deleted) {
      this.sidebarWebContents.send('script-deleted', { scriptId });
    }
    return deleted;
  }

  /**
   * Clear all scripts
   */
  clearAllScripts(): void {
    this.scripts.clear();
    this.sidebarWebContents.send('scripts-cleared');
  }

  /**
   * Validate script for safety and size constraints
   */
  private validateScript(code: string): { valid: boolean; error?: string } {
    // Check script length
    if (code.length > MAX_SCRIPT_LENGTH) {
      return {
        valid: false,
        error: `Script exceeds maximum length of ${MAX_SCRIPT_LENGTH} characters`,
      };
    }

    // Check for empty script
    if (!code.trim()) {
      return {
        valid: false,
        error: 'Script cannot be empty',
      };
    }

    // Basic security checks - look for dangerous patterns
    const dangerousPatterns = [
      /require\s*\(/i,           // Node.js require (shouldn't work in renderer but check anyway)
      /import\s+.*\s+from/i,     // ES6 imports (won't work in executeJavaScript context)
      /__dirname/i,              // Node.js globals
      /__filename/i,
      /process\./i,
      /electron\./i,             // Direct Electron API access
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(code)) {
        return {
          valid: false,
          error: `Script contains potentially unsafe pattern: ${pattern.source}`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Generate a unique script ID
   */
  private generateScriptId(): string {
    return `script-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Notify the sidebar about script updates
   */
  private notifyScriptUpdate(script: Script): void {
    this.sidebarWebContents.send('script-updated', script);
  }

  /**
   * Extract code blocks from LLM response
   */
  extractCodeFromResponse(response: string): string[] {
    const codeBlocks: string[] = [];
    
    // Match code blocks with ```javascript, ```js, or just ```
    const codeBlockRegex = /```(?:javascript|js)?\n([\s\S]*?)```/g;
    let match;

    while ((match = codeBlockRegex.exec(response)) !== null) {
      const code = match[1].trim();
      if (code) {
        codeBlocks.push(code);
      }
    }

    return codeBlocks;
  }

  /**
   * Auto-detect and extract script from LLM response
   */
  autoExtractAndAddScript(response: string, description?: string): Script | null {
    const codeBlocks = this.extractCodeFromResponse(response);
    
    if (codeBlocks.length === 0) {
      return null;
    }

    // For now, take the first code block
    // In the future, we could be smarter about combining multiple blocks
    const code = codeBlocks[0];
    
    return this.addScript(code, description || 'Auto-extracted from AI response');
  }
}
