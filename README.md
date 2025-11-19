# Code Execution Engine for Browser-Based Coding Agent

This document explains the implementation of a full in-browser agentic system capable of generating, validating, approving, and executing JavaScript automation scripts within isolated browser tab contexts.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Implementation Steps](#implementation-steps)
  - [Step 1: Chat Mode Toggle](#step-1-chat-mode-toggle)
  - [Step 2: Script Management System](#step-2-script-management-system)
  - [Step 3: Enhanced LLM Integration](#step-3-enhanced-llm-integration)
  - [Step 4: Script Execution Engine](#step-4-script-execution-engine)
  - [Step 5: UI Components](#step-5-ui-components)
  - [Step 6: Event System & Real-time Updates](#step-6-event-system--real-time-updates)
- [Security Architecture](#security-architecture)
- [Execution Flow](#execution-flow)
- [Files Changed](#files-changed)
- [Future Improvements](#future-improvements)

## Overview

The coding agent allows users to:

- **Generate** JavaScript automation scripts via AI (OpenAI/Anthropic)
- **Execute** scripts safely within isolated browser tabs
- **Interact** with DOM using 20+ high-level utility functions
- **Return** structured results back to the UI

## Architecture

```
┌─────────────────────────┐
│      Sidebar UI         │
│  - Chat/Agent Toggle    │
│  - Script Results       │
│  - Approval Controls    │
└───────────┬─────────────┘
            │ IPC
            ▼
┌─────────────────────────┐
│     ChatContext         │
│  - Mode: chat/agent     │
│  - Message history      │
│  - Script state         │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│      LLMClient          │
│  - System prompts       │
│  - DOM analysis         │
│  - Screenshot capture   │
│  - Auto-extraction      │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│    ScriptManager        │
│  - Validation           │
│  - Storage              │
│  - Approval tracking    │
│  - Execution routing    │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│    Tab (Execution)      │
│  - Script wrapping      │
│  - Timeout protection   │
│  - Helper injection     │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│   Helper Functions      │
│  - DOM utils            │
│  - Form filling         │
│  - Data extraction      │
│  - Style manipulation   │
└─────────────────────────┘
```

## Implementation Steps

### Step 1: Chat Mode Toggle

**Objective**: Allow users to switch between conversational chat and code generation modes.

#### Changes Made

- **`contexts/ChatContext.tsx`**: Added `chatMode` state (`'chat' | 'agent'`)
- **`components/ModeToggle.tsx`** (NEW): Pill-style toggle with icons

- Added mode-specific system prompts:
  - `buildChatSystemPrompt()`: General assistance
  - `buildAgentSystemPrompt()`: Code generation with helper documentation

**Key Features**

- UI updates placeholders and empty states per mode
- Different LLM behavior based on mode
- Seamless mode switching without losing context

---

### Step 2: Script Management System

**Objective**: Complete lifecycle management for AI-generated scripts.

#### New File: `src/main/ScriptManager.ts`

**Core Capabilities**

- Store scripts with metadata
- Validate before execution (pattern scanning, size limits)
- Approval workflow (all scripts start as `'pending'`)
- Auto-extract JavaScript from LLM responses
- Track execution state and results

**Key Methods**

- `addScript()`: Store new script
- `approveScript()`: Mark as safe to execute
- `executeScript()`: Run via Tab.executeScript()
- `autoExtractAndAddScript()`: Parse LLM response for ```javascript blocks
- `validateScript()`: Check for dangerous patterns, size limits

**Security Validations**

- Max script size: 50KB
- Blocked patterns: `require()`, `import`, `eval()`, `__dirname`, etc.
- Empty script detection

---

### Step 3: Enhanced LLM Integration

**Objective**: Transform LLM into an automation engineer with comprehensive context.

#### Changes to `src/main/LLMClient.ts`

**1. Advanced DOM Structure Analysis** (`getDOMStructureHints()`)
Completely rewritten to provide:

**Element Discovery**

- Forms with action/method/field count
- Inputs/textareas with labels, types, required status
- Buttons with text and disabled state
- Select dropdowns with option counts
- Checkboxes/radios with checked state
- Semantic landmarks (header, nav, main, footer)

**Selector Strategies** (8 per element)

1. ID (highest reliability)
2. Name attribute
3. Test IDs (data-testid, data-test-id, data-cy)
4. ARIA labels
5. Placeholder text
6. Data attributes
7. Classes
8. XPath

Each strategy includes:

- Reliability rating (`'high'`, `'medium'`, `'low'`)
- Ready-to-use JavaScript code snippet
- Selector string

**Context Detection**

- Parent hierarchy (forms, sections, semantic containers)
- ARIA landmarks and roles
- Framework detection (React, Vue, Angular, jQuery)

**Smart HTML Extraction**

- Elements with children: opening tag only
- Leaf elements: full HTML (truncated at 300-400 chars)
- Selects: opening tag + first 3 options
- Forms: opening tag with attributes

**2. Agent Prompt**

- 20+ helper functions
- Code requirements and restrictions
- Response format guidelines

**Outcome**: LLM generates highly structured, safe, context-aware scripts with proper selectors.

---

### Step 4: Script Execution Engine

**Objective**: Safely execute scripts in browser tabs with timeout protection and helper injection.

#### Changes to `src/main/Tab.ts`

**New Methods**

**`executeScript(code, options)`**

- Wraps user code with helper functions
- Timeout protection (30s default)
- Error capturing with stack traces
- Execution timing

**`wrapScriptForExecution(code)`**
Injects 20+ helper functions into script context.

---

### Step 5: UI Components

**Objective**: Display scripts with status, approval controls, and results.

#### New File: `src/renderer/sidebar/src/components/ScriptResult.tsx`

**Action Buttons** (context-sensitive)

- **Pending**: "Approve & Run" + "Delete"
- **Approved**: "Run Script" + "Delete"
- **Running**: "Running..." (disabled)
- **Completed/Failed**: "Delete"

**Components**

- `StatusBadge`: Status indicator with icon
- `ErrorDisplay`: Formatted error messages
- `ResultDisplay`: JSON viewer with collapsible sections

#### Integration in `src/renderer/sidebar/src/components/Chat.tsx`

Added handlers:

- `handleApproveScript(scriptId)`: Approve and auto-execute
- `handleExecuteScript(scriptId)`: Execute approved script
- `handleDeleteScript(scriptId)`: Remove from list

Scripts rendered below messages with full controls.

---

### Step 6: Event System & Real-time Updates

**Objective**: Real-time UI updates when scripts change state.

#### IPC Events (`src/main/EventManager.ts`)

**Handlers Added**

- `add-script`: Store new script
- `approve-script`: Mark as approved
- `execute-script`: Execute with result
- `delete-script`: Remove from list
- `clear-all-scripts`: Clear all
- `get-script` / `get-all-scripts`: Retrieve scripts
- `auto-extract-script`: Parse AI response
- `tab-execute-script`: Direct tab execution
- `tab-is-ready` / `tab-wait-ready`: Page readiness

**Event Listeners**

- `script-updated`: Updates or adds script in state
- `script-deleted`: Filters out deleted script immediately
- `scripts-cleared`: Resets scripts array

**Auto-Extraction Flow**

1. LLM completes response in agent mode
2. `handleAgentResponse()` called in LLMClient
3. `autoExtractAndAddScript()` parses ```javascript blocks
4. Script added with `status: 'pending'`
5. `script-updated` event fired
6. UI updates with approval buttons

---

## Security Architecture

Security is enforced at **multiple layers**.

### 1. Validation Layer (ScriptManager)

- Script size limit: **50KB**
- Dangerous pattern blocking:
  - `require()`, `import`, `eval()`
  - `process`, `__dirname`, `__filename`
  - Electron APIs
- Empty script detection

### 2. Approval Layer

- All scripts start as `'pending'`
- Must be manually approved via UI
- No auto-execution without approval

### 3. Execution Layer (Tab)

- Browser DOM context only (no Node.js APIs)
- No direct IPC access from scripts
- Wrappers prevent unhandled exceptions
- Timeout protection (30s)
- Async errors caught and structured

### 4. Communication Layer

- Whitelisted IPC channels only
- Sanitized return values (circular references removed)
- No access to Electron internals or prototypes

### 5. Isolation

- Scripts run in tab's web context (sandboxed)
- Cannot access other tabs or main process
- Helper functions are pure utilities (no system access)

---

## Execution Flow

````
1. User selects "Code Agent" mode
   └─> ChatContext.setChatMode('agent')

2. User sends instruction (e.g., "Fill the login form")
   └─> ChatContext.sendMessage()
       └─> IPC: sidebar-send-message

3. LLMClient receives request
   ├─> Captures screenshot via tab.screenshot()
   ├─> Analyzes DOM via getDOMStructureHints()
   ├─> Builds agent system prompt with helpers
   └─> Streams response from OpenAI/Anthropic

4. LLM generates JavaScript code in response

5. Auto-extraction triggered
   └─> LLMClient.handleAgentResponse()
       └─> ScriptManager.autoExtractAndAddScript()
           ├─> Extracts ```javascript blocks
           ├─> Validates code
           └─> Stores with status='pending'

6. UI updates with script card
   └─> Event: script-updated
       └─> ScriptResult component renders
           └─> Shows "Approve & Run" button

7. User clicks "Approve & Run"
   └─> Chat.handleApproveScript()
       ├─> IPC: approve-script
       └─> IPC: execute-script

8. ScriptManager.executeScript()
   └─> Gets active tab
       └─> Tab.executeScript(code)
           ├─> Wraps code with helpers
           ├─> Executes via webContents.executeJavaScript()
           ├─> Captures result/error
           └─> Returns sanitized result

9. Script status updated
   ├─> status='running' (during execution)
   └─> status='completed' or 'failed' (after)

10. UI updates with results
    └─> Event: script-updated
        └─> ScriptResult shows:
            ├─> Execution time
            ├─> Result (JSON viewer)
            └─> Error (if failed)

11. User sees structured output
    └─> Can delete, re-run, or continue conversation
````

---

---

## Development Process

This feature was implemented using an **AI-assisted iterative development workflow**. Here's how the process unfolded (more or less):

### 1. **Codebase Analysis**

Started by thoroughly reading the entire existing codebase to understand:

- Architecture patterns (Electron main/renderer/preload separation)
- IPC communication flow
- Existing LLM integration
- UI component structure
- State management approach

### 2. **Architecture Design**

Sketched the ideal architecture for the code execution system:

- Identified key components needed (ScriptManager, execution engine, UI)
- Mapped data flow from user input to script execution
- Designed security layers and validation points
- Planned the approval workflow

### 3. **AI-Assisted Planning**

Refined the implementation steps using multiple LLMs:

- **ChatGPT**: Used for high-level architecture validation
- **Claude Sonnet 4.5**: Used for detailed technical planning and code structure
- Iterated on the design until all steps were clear and well-defined
- Created a step-by-step implementation roadmap

### 4. **Incremental Implementation**

For each step in the roadmap:

- Prompted the coding agent with specific requirements
- Referenced existing code patterns and architecture

### 5. **Code Review & Refinement**

After each code generation:

- **Carefully reviewed** all generated code line-by-line
- **Manually corrected** unwanted behaviors or anti-patterns
- **Optimized** implementations to better match the vision
- **Ensured consistency** with existing codebase style

### 6. **Safety & Quality Checks**

Before moving to the next step:

- Verified the code was doing **exactly** what was intended
- Checked for **security vulnerabilities** (especially in script execution)
- Ensured **proper error handling** and edge cases
- Validated **user experience** flows

### 7. **Iterative Testing**

After core implementation:

- Tested the solution with various scenarios
- Fixed bugs as they appeared
- Refined error messages and UI feedback

---

## Summary

This implementation adds a **coding agent** to the browser with:

- ✅ **Safe execution** via multi-layer security
- ✅ **Rich context** from DOM analysis and screenshots
- ✅ **20+ helper functions** for common tasks
- ✅ **Approval workflow** for user control
- ✅ **Real-time UI** with status tracking
- ✅ **Auto-extraction** from AI responses
- ✅ **Comprehensive error handling** and timeout protection
