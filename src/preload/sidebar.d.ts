import { ElectronAPI } from "@electron-toolkit/preload";

export type ChatMode = 'chat' | 'agent'

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
  tabId?: string;
}

export interface ScriptExecutionResult {
  scriptId: string;
  success: boolean;
  result?: any;
  error?: string;
  executionTime: number;
}

interface ChatRequest {
  message: string;
  context: {
    url: string | null;
    content: string | null;
    text: string | null;
  };
  messageId: string;
  mode?: ChatMode;
}

interface ChatResponse {
  messageId: string;
  content: string;
  isComplete: boolean;
}

interface TabInfo {
  id: string;
  title: string;
  url: string;
  isActive: boolean;
}

interface SidebarAPI {
  // Chat functionality
  sendChatMessage: (request: ChatRequest) => Promise<void>;
  clearChat: () => Promise<void>;
  getMessages: () => Promise<any[]>;
  onChatResponse: (callback: (data: ChatResponse) => void) => void;
  onMessagesUpdated: (callback: (messages: any[]) => void) => void;
  removeChatResponseListener: () => void;
  removeMessagesUpdatedListener: () => void;

  // Page content access
  getPageContent: () => Promise<string | null>;
  getPageText: () => Promise<string | null>;
  getCurrentUrl: () => Promise<string | null>;

  // Tab information
  getActiveTabInfo: () => Promise<TabInfo | null>;

  // Script management
  addScript: (code: string, description?: string) => Promise<Script>;
  getScript: (scriptId: string) => Promise<Script | null>;
  getAllScripts: () => Promise<Script[]>;
  approveScript: (scriptId: string) => Promise<boolean>;
  executeScript: (request: ScriptExecutionRequest) => Promise<ScriptExecutionResult>;
  deleteScript: (scriptId: string) => Promise<boolean>;
  clearAllScripts: () => Promise<boolean>;
  extractCode: (text: string) => Promise<string[]>;
  autoExtractScript: (response: string, description?: string) => Promise<Script | null>;
  
  // Script event listeners
  onScriptUpdated: (callback: (script: Script) => void) => void;
  onScriptDeleted: (callback: (data: { scriptId: string }) => void) => void;
  onScriptsCleared: (callback: () => void) => void;
  removeScriptUpdateListener: () => void;
  removeScriptDeleteListener: () => void;
  removeScriptsClearedListener: () => void;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    sidebarAPI: SidebarAPI;
  }
}

