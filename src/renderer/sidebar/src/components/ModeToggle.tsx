import React from 'react'
import { MessageSquare, Code2 } from 'lucide-react'
import { cn } from '@common/lib/utils'
import type { ChatMode } from '../contexts/ChatContext'

interface ModeToggleProps {
  mode: ChatMode
  onModeChange: (mode: ChatMode) => void
  disabled?: boolean
}

export const ModeToggle: React.FC<ModeToggleProps> = ({ mode, onModeChange, disabled }) => {
  return (
    <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-full">
      <button
        onClick={() => onModeChange('chat')}
        disabled={disabled}
        className={cn(
          "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium",
          "transition-all duration-200",
          mode === 'chat'
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <MessageSquare className="size-4" />
        Chat
      </button>
      <button
        onClick={() => onModeChange('agent')}
        disabled={disabled}
        className={cn(
          "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium",
          "transition-all duration-200",
          mode === 'agent'
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <Code2 className="size-4" />
        Code Agent
      </button>
    </div>
  )
}
