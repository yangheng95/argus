export type AgentRoleID =
  | "coding"
  | "build"
  | "general"
  | "explore"
  | "compaction"
  | "title"
  | "summary"
  | "control"
  | "orchestrator"
  | "requirements"
  | "architect"
  | "design-analyst"
  | "intent-analysis"
  | "integrity"
  | "fact-check"

export interface AgentRoleContract {
  id: AgentRoleID
  description: string
  promptEditable: boolean
  defaultPromptRequired: boolean
  promptConfigMode: "override" | "append" | "none"
}

export namespace AgentRoleContract {
  export const all: Record<AgentRoleID, AgentRoleContract> = {
    coding: {
      id: "coding",
      description: "Direct coding assistant for ad hoc workspace edits outside the task workflow.",
      promptEditable: true,
      defaultPromptRequired: true,
      promptConfigMode: "override",
    },
    build: {
      id: "build",
      description: "Workflow build stage. Executes one scoped task or goal through the build-core terminal-report contract.",
      promptEditable: true,
      defaultPromptRequired: true,
      promptConfigMode: "append",
    },
    general: {
      id: "general",
      description: "General-purpose subagent for multi-step research and parallel work.",
      promptEditable: true,
      defaultPromptRequired: true,
      promptConfigMode: "override",
    },
    explore: {
      id: "explore",
      description: "Read-oriented codebase exploration subagent for fast file, symbol, and code search.",
      promptEditable: true,
      defaultPromptRequired: true,
      promptConfigMode: "override",
    },
    compaction: {
      id: "compaction",
      description: "Internal summary agent for transcript checkpoint compaction.",
      promptEditable: true,
      defaultPromptRequired: true,
      promptConfigMode: "override",
    },
    title: {
      id: "title",
      description: "Internal title agent for generating concise session titles.",
      promptEditable: true,
      defaultPromptRequired: true,
      promptConfigMode: "override",
    },
    summary: {
      id: "summary",
      description: "Internal follow-up summary model-routing slot; its prompt is built by the caller.",
      promptEditable: false,
      defaultPromptRequired: false,
      promptConfigMode: "none",
    },
    control: {
      id: "control",
      description: "Control-plane agent. Routes panel and gateway natural-language requests through the panel tool.",
      promptEditable: true,
      defaultPromptRequired: true,
      promptConfigMode: "override",
    },
    orchestrator: {
      id: "orchestrator",
      description: "Orchestrator agent. Owns task lifecycle decisions and dispatches explicit workflow tools.",
      promptEditable: false,
      defaultPromptRequired: false,
      promptConfigMode: "none",
    },
    requirements: {
      id: "requirements",
      description: "Requirements agent. Extracts user requirements and foundational technical decisions; it does not produce goals.",
      promptEditable: true,
      defaultPromptRequired: true,
      promptConfigMode: "append",
    },
    architect: {
      id: "architect",
      description: "Architect agent. Owns the goal graph, traceability, assembly ownership, and cross-goal contracts.",
      promptEditable: true,
      defaultPromptRequired: true,
      promptConfigMode: "append",
    },
    "design-analyst": {
      id: "design-analyst",
      description: "Design analyst agent. Converts visual/reference evidence into PRD and implementation constraints.",
      promptEditable: true,
      defaultPromptRequired: true,
      promptConfigMode: "append",
    },
    "intent-analysis": {
      id: "intent-analysis",
      description: "Intent-analysis agent. Disambiguates the raw request into intent, complexity, slots, missing info, and clarifications.",
      promptEditable: true,
      defaultPromptRequired: true,
      promptConfigMode: "append",
    },
    integrity: {
      id: "integrity",
      description: "Integrity reviewer. Audits requirement and goal integrity and owns final session-bound acceptance review, including runtime, frontend, visual, and rejection-detail evidence.",
      promptEditable: true,
      defaultPromptRequired: true,
      promptConfigMode: "append",
    },
    "fact-check": {
      id: "fact-check",
      description: "Fact-check agent. Verifies factual claims (APIs, library versions, numbers, paths, historical decisions) emitted by worker agents in their terminal report `fact_check_items[]`. Dispatched by the orchestrator after integrity pass; outputs structured verified/corrected/unresolved findings with evidence pointers.",
      promptEditable: true,
      defaultPromptRequired: true,
      promptConfigMode: "append",
    },
  }

  export function get(id: AgentRoleID): AgentRoleContract {
    return all[id]
  }

  export function description(id: AgentRoleID): string {
    return get(id).description
  }
}
