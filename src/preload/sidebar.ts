import { contextBridge } from "electron";
import { electronAPI } from "@electron-toolkit/preload";

export type ChatMode = 'chat' | 'agent'

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

// Sidebar specific APIs
const sidebarAPI = {
  // Chat functionality
  sendChatMessage: (request: Partial<ChatRequest>) =>
    electronAPI.ipcRenderer.invoke("sidebar-chat-message", request),

  clearChat: () => electronAPI.ipcRenderer.invoke("sidebar-clear-chat"),

  getMessages: () => electronAPI.ipcRenderer.invoke("sidebar-get-messages"),

  onChatResponse: (callback: (data: ChatResponse) => void) => {
    electronAPI.ipcRenderer.on("chat-response", (_, data) => callback(data));
  },

  onMessagesUpdated: (callback: (messages: any[]) => void) => {
    electronAPI.ipcRenderer.on("chat-messages-updated", (_, messages) =>
      callback(messages)
    );
  },

  removeChatResponseListener: () => {
    electronAPI.ipcRenderer.removeAllListeners("chat-response");
  },

  removeMessagesUpdatedListener: () => {
    electronAPI.ipcRenderer.removeAllListeners("chat-messages-updated");
  },

  // Page content access
  getPageContent: () => electronAPI.ipcRenderer.invoke("get-page-content"),
  getPageText: () => electronAPI.ipcRenderer.invoke("get-page-text"),
  getCurrentUrl: () => electronAPI.ipcRenderer.invoke("get-current-url"),

  // Tab information
  getActiveTabInfo: () => electronAPI.ipcRenderer.invoke("get-active-tab-info"),

  // Script management
  addScript: (code: string, description?: string) =>
    electronAPI.ipcRenderer.invoke("add-script", code, description),

  getScript: (scriptId: string) =>
    electronAPI.ipcRenderer.invoke("get-script", scriptId),

  getAllScripts: () =>
    electronAPI.ipcRenderer.invoke("get-all-scripts"),

  approveScript: (scriptId: string) =>
    electronAPI.ipcRenderer.invoke("approve-script", scriptId),

  executeScript: (request: any) =>
    electronAPI.ipcRenderer.invoke("execute-script", request),

  deleteScript: (scriptId: string) =>
    electronAPI.ipcRenderer.invoke("delete-script", scriptId),

  clearAllScripts: () =>
    electronAPI.ipcRenderer.invoke("clear-all-scripts"),

  extractCode: (text: string) =>
    electronAPI.ipcRenderer.invoke("extract-code", text),

  autoExtractScript: (response: string, description?: string) =>
    electronAPI.ipcRenderer.invoke("auto-extract-script", response, description),

  // Script event listeners
  onScriptUpdated: (callback: (script: any) => void) => {
    electronAPI.ipcRenderer.on("script-updated", (_, script) => callback(script));
  },

  onScriptDeleted: (callback: (data: { scriptId: string }) => void) => {
    electronAPI.ipcRenderer.on("script-deleted", (_, data) => callback(data));
  },

  onScriptsCleared: (callback: () => void) => {
    electronAPI.ipcRenderer.on("scripts-cleared", () => callback());
  },

  removeScriptUpdateListener: () => {
    electronAPI.ipcRenderer.removeAllListeners("script-updated");
  },

  removeScriptDeleteListener: () => {
    electronAPI.ipcRenderer.removeAllListeners("script-deleted");
  },

  removeScriptsClearedListener: () => {
    electronAPI.ipcRenderer.removeAllListeners("scripts-cleared");
  },
};

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("sidebarAPI", sidebarAPI);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI;
  // @ts-ignore (define in dts)
  window.sidebarAPI = sidebarAPI;
}
