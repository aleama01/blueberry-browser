import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'

export type ChatMode = 'chat' | 'agent'

interface Script {
  id: string
  code: string
  description?: string
  createdAt: number
  status: 'pending' | 'approved' | 'running' | 'completed' | 'failed'
  result?: any
  error?: string
  tabId?: string
  executionTime?: number
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  isStreaming?: boolean
}

interface ChatContextType {
  messages: Message[]
  isLoading: boolean
  chatMode: ChatMode
  scripts: Script[]

  // Chat actions
  sendMessage: (content: string) => Promise<void>
  clearChat: () => void
  setChatMode: (mode: ChatMode) => void

  // Script actions
  getScripts: () => Promise<void>
  approveAndExecuteScript: (scriptId: string) => Promise<void>

  // Page content access
  getPageContent: () => Promise<string | null>
  getPageText: () => Promise<string | null>
  getCurrentUrl: () => Promise<string | null>
}

const ChatContext = createContext<ChatContextType | null>(null)

export const useChat = () => {
  const context = useContext(ChatContext)
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider')
  }
  return context
}

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [chatMode, setChatMode] = useState<ChatMode>('chat')
  const [scripts, setScripts] = useState<Script[]>([])

  // Load initial messages from main process
  useEffect(() => {
    const loadMessages = async () => {
      try {
        const storedMessages = await window.sidebarAPI.getMessages()
        if (storedMessages && storedMessages.length > 0) {
          // Convert CoreMessage format to our frontend Message format
          const convertedMessages = storedMessages.map((msg: any, index: number) => ({
            id: `msg-${index}`,
            role: msg.role,
            content: typeof msg.content === 'string'
              ? msg.content
              : msg.content.find((p: any) => p.type === 'text')?.text || '',
            timestamp: Date.now(),
            isStreaming: false
          }))
          setMessages(convertedMessages)
        }
      } catch (error) {
        console.error('Failed to load messages:', error)
      }
    }
    loadMessages()
  }, [])

  // Load scripts from main process
  const getScripts = useCallback(async () => {
    try {
      const allScripts = await window.sidebarAPI.getAllScripts()
      setScripts(allScripts)
    } catch (error) {
      console.error('Failed to load scripts:', error)
    }
  }, [])

  // Load scripts on mount
  useEffect(() => {
    getScripts()
  }, [getScripts])

  // Approve and execute a script
  const approveAndExecuteScript = useCallback(async (scriptId: string) => {
    try {
      await window.sidebarAPI.approveScript(scriptId)
      await window.sidebarAPI.executeScript({ scriptId })
      await getScripts() // Refresh scripts after execution
    } catch (error) {
      console.error('Failed to execute script:', error)
    }
  }, [getScripts])

  const sendMessage = useCallback(async (content: string) => {
    setIsLoading(true)

    try {
      const messageId = Date.now().toString()

      // Send message to main process with mode
      await window.sidebarAPI.sendChatMessage({
        message: content,
        messageId: messageId,
        mode: chatMode,
        context: {
          url: null,
          content: null,
          text: null
        }
      })

      // Messages will be updated via the chat-messages-updated event
    } catch (error) {
      console.error('Failed to send message:', error)
    } finally {
      setIsLoading(false)
    }
  }, [chatMode])

  const clearChat = useCallback(async () => {
    try {
      await window.sidebarAPI.clearChat()
      setMessages([])
    } catch (error) {
      console.error('Failed to clear chat:', error)
    }
  }, [])

  const getPageContent = useCallback(async () => {
    try {
      return await window.sidebarAPI.getPageContent()
    } catch (error) {
      console.error('Failed to get page content:', error)
      return null
    }
  }, [])

  const getPageText = useCallback(async () => {
    try {
      return await window.sidebarAPI.getPageText()
    } catch (error) {
      console.error('Failed to get page text:', error)
      return null
    }
  }, [])

  const getCurrentUrl = useCallback(async () => {
    try {
      return await window.sidebarAPI.getCurrentUrl()
    } catch (error) {
      console.error('Failed to get current URL:', error)
      return null
    }
  }, [])

  // Set up message listeners
  useEffect(() => {
    // Listen for streaming response updates
    const handleChatResponse = (data: { messageId: string; content: string; isComplete: boolean }) => {
      if (data.isComplete) {
        setIsLoading(false)
      }
    }

    // Listen for message updates from main process
    const handleMessagesUpdated = (updatedMessages: any[]) => {
      // Convert CoreMessage format to our frontend Message format
      const convertedMessages = updatedMessages.map((msg: any, index: number) => ({
        id: `msg-${index}`,
        role: msg.role,
        content: typeof msg.content === 'string'
          ? msg.content
          : msg.content.find((p: any) => p.type === 'text')?.text || '',
        timestamp: Date.now(),
        isStreaming: false
      }))
      setMessages(convertedMessages)
    }

    // Listen for script updates
    const handleScriptUpdated = (script: Script) => {
      setScripts(prevScripts => {
        const index = prevScripts.findIndex(s => s.id === script.id)
        if (index >= 0) {
          const newScripts = [...prevScripts]
          newScripts[index] = script
          return newScripts
        }
        return [...prevScripts, script]
      })
    }

    // Listen for script deletions
    const handleScriptDeleted = (data: { scriptId: string }) => {
      setScripts(prevScripts => prevScripts.filter(s => s.id !== data.scriptId))
    }

    // Listen for all scripts cleared
    const handleScriptsCleared = () => {
      setScripts([])
    }

    window.sidebarAPI.onChatResponse(handleChatResponse)
    window.sidebarAPI.onMessagesUpdated(handleMessagesUpdated)
    window.sidebarAPI.onScriptUpdated(handleScriptUpdated)
    window.sidebarAPI.onScriptDeleted(handleScriptDeleted)
    window.sidebarAPI.onScriptsCleared(handleScriptsCleared)

    return () => {
      window.sidebarAPI.removeChatResponseListener()
      window.sidebarAPI.removeMessagesUpdatedListener()
      window.sidebarAPI.removeScriptUpdateListener()
      window.sidebarAPI.removeScriptDeleteListener()
      window.sidebarAPI.removeScriptsClearedListener()
    }
  }, [])

  const value: ChatContextType = {
    messages,
    isLoading,
    chatMode,
    scripts,
    sendMessage,
    clearChat,
    setChatMode,
    getScripts,
    approveAndExecuteScript,
    getPageContent,
    getPageText,
    getCurrentUrl
  }

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  )
}

