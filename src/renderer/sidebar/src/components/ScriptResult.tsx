import React from 'react'
import { CheckCircle2, XCircle, Clock, Code2, AlertTriangle } from 'lucide-react'
import { cn } from '@common/lib/utils'

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

interface ScriptResultProps {
  script: Script
}

// Format execution time in ms
const formatExecutionTime = (ms: number): string => {
  if (ms < 1000) return `${ms.toFixed(0)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

// Format result for display
const formatResult = (result: any): string => {
  if (result === null) return 'null'
  if (result === undefined) return 'undefined'
  if (typeof result === 'string') return result
  if (typeof result === 'number' || typeof result === 'boolean') return String(result)

  try {
    return JSON.stringify(result, null, 2)
  } catch {
    return String(result)
  }
}

// Status Badge Component
const StatusBadge: React.FC<{ status: Script['status'] }> = ({ status }) => {
  const configs = {
    pending: {
      icon: Clock,
      text: 'Pending Approval',
      className: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-500 border-yellow-500/20'
    },
    approved: {
      icon: CheckCircle2,
      text: 'Approved',
      className: 'bg-green-500/10 text-green-600 dark:text-green-500 border-green-500/20'
    },
    running: {
      icon: Code2,
      text: 'Running...',
      className: 'bg-blue-500/10 text-blue-600 dark:text-blue-500 border-blue-500/20 animate-pulse'
    },
    completed: {
      icon: CheckCircle2,
      text: 'Completed',
      className: 'bg-green-500/10 text-green-600 dark:text-green-500 border-green-500/20'
    },
    failed: {
      icon: XCircle,
      text: 'Failed',
      className: 'bg-red-500/10 text-red-600 dark:text-red-500 border-red-500/20'
    }
  }

  const config = configs[status]
  const Icon = config.icon

  return (
    <div className={cn(
      'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border',
      config.className
    )}>
      <Icon className="size-3" />
      {config.text}
    </div>
  )
}

// Error Display Component
const ErrorDisplay: React.FC<{ error: string }> = ({ error }) => {
  // Try to parse stack trace if present
  const lines = error.split('\n')
  const errorMessage = lines[0]
  const stackTrace = lines.slice(1).filter(line => line.trim())

  return (
    <div className="mt-3 p-3 rounded-lg bg-red-500/5 border border-red-500/20">
      <div className="flex items-start gap-2">
        <AlertTriangle className="size-4 text-red-600 dark:text-red-500 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-red-600 dark:text-red-500 text-sm">
            {errorMessage}
          </div>
          {stackTrace.length > 0 && (
            <div className="mt-2 text-xs text-red-600/80 dark:text-red-500/80 font-mono space-y-0.5">
              {stackTrace.map((line) => (
                <div key={line} className="truncate" title={line}>
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Result Display Component
const ResultDisplay: React.FC<{ result: any; executionTime?: number }> = ({ result, executionTime }) => {
  const formattedResult = formatResult(result)
  const isLongResult = formattedResult.length > 500
  const [isExpanded, setIsExpanded] = React.useState(false)

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-medium text-muted-foreground">
          Result
        </div>
        {executionTime !== undefined && (
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="size-3" />
            {formatExecutionTime(executionTime)}
          </div>
        )}
      </div>
      <div className="p-3 rounded-lg bg-muted/50 dark:bg-muted/30 border border-border">
        <pre className={cn(
          "text-xs font-mono text-foreground whitespace-pre-wrap break-words",
          isLongResult && !isExpanded && "line-clamp-10"
        )}>
          {formattedResult}
        </pre>
        {isLongResult && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="mt-2 text-xs text-primary hover:underline"
          >
            {isExpanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    </div>
  )
}

// Code Display Component
const CodeDisplay: React.FC<{ code: string }> = ({ code }) => {
  const [isExpanded, setIsExpanded] = React.useState(false)
  const lines = code.split('\n')
  const isLongCode = lines.length > 10

  return (
    <div className="mt-3">
      <div className="text-xs font-medium text-muted-foreground mb-2">
        Script Code
      </div>
      <div className="p-3 rounded-lg bg-muted/50 dark:bg-muted/30 border border-border">
        <pre className={cn(
          "text-xs font-mono text-foreground whitespace-pre-wrap break-words",
          isLongCode && !isExpanded && "line-clamp-10"
        )}>
          {code}
        </pre>
        {isLongCode && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="mt-2 text-xs text-primary hover:underline"
          >
            {isExpanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    </div>
  )
}

// Main ScriptResult Component
export const ScriptResult: React.FC<ScriptResultProps> = ({ script }) => {
  return (
    <div className="w-full p-4 rounded-lg border border-border bg-background/50 dark:bg-secondary/30 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          {script.description && (
            <div className="text-sm font-medium text-foreground mb-1 break-words">
              {script.description}
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            Script ID: {script.id.slice(0, 8)}
          </div>
        </div>
        <StatusBadge status={script.status} />
      </div>

      {/* Script Code */}
      <CodeDisplay code={script.code} />

      {/* Error Display */}
      {script.error && <ErrorDisplay error={script.error} />}

      {/* Result Display */}
      {script.result !== undefined && script.status === 'completed' && (
        <ResultDisplay
          result={script.result}
          executionTime={script.executionTime}
        />
      )}

      {/* Pending Approval Message */}
      {script.status === 'pending' && (
        <div className="mt-3 p-3 rounded-lg bg-yellow-500/5 border border-yellow-500/20">
          <div className="flex items-start gap-2">
            <AlertTriangle className="size-4 text-yellow-600 dark:text-yellow-500 mt-0.5 flex-shrink-0" />
            <div className="flex-1 text-xs text-yellow-600 dark:text-yellow-500">
              This script requires approval before execution. Review the code carefully.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
