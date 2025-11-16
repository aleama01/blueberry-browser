import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'

export type ChatMode = 'chat' | 'agent'

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

  // Chat actions
  sendMessage: (content: string) => Promise<void>
  clearChat: () => void
  setChatMode: (mode: ChatMode) => void

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

    window.sidebarAPI.onChatResponse(handleChatResponse)
    window.sidebarAPI.onMessagesUpdated(handleMessagesUpdated)

    return () => {
      window.sidebarAPI.removeChatResponseListener()
      window.sidebarAPI.removeMessagesUpdatedListener()
    }
  }, [])

  const value: ChatContextType = {
    messages,
    isLoading,
    chatMode,
    sendMessage,
    clearChat,
    setChatMode,
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

