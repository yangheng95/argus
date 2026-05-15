export type AgentRoleID =
  | "build"
  | "general"
  | "explore"
  | "compaction"
  | "title"
  | "summary"
  | "control"
  | "delivery"
  | "orchestrator"
  | "requirements"
  | "architect"
  | "design-analyst"
  | "intent-analysis"
  | "integrity"
  | "prosecutor"

export interface AgentRoleContract {
  id: AgentRoleID
  description: string
  promptEditable: boolean
  defaultPromptRequired: boolean
}

export namespace AgentRoleContract {
  export const all: Record<AgentRoleID, AgentRoleContract> = {
    build: {
      id: "build",
      description: "Default implementation agent. Executes workspace tools under configured permissions.",
      promptEditable: true,
      defaultPromptRequired: true,
    },
    general: {
      id: "general",
      description: "General-purpose subagent for multi-step research and parallel work.",
      promptEditable: true,
      defaultPromptRequired: true,
    },
    explore: {
      id: "explore",
      description: "Read-oriented codebase exploration subagent for fast file, symbol, and code search.",
      promptEditable: true,
      defaultPromptRequired: true,
    },
    compaction: {
      id: "compaction",
      description: "Internal summary agent for transcript checkpoint compaction.",
      promptEditable: true,
      defaultPromptRequired: true,
    },
    title: {
      id: "title",
      description: "Internal title agent for generating concise session titles.",
      promptEditable: true,
      defaultPromptRequired: true,
    },
    summary: {
      id: "summary",
      description: "Internal follow-up summary model-routing slot; its prompt is built by the caller.",
      promptEditable: false,
      defaultPromptRequired: false,
    },
    control: {
      id: "control",
      description: "Control-plane agent. Routes panel and gateway natural-language requests through the panel tool.",
      promptEditable: true,
      defaultPromptRequired: true,
    },
    delivery: {
      id: "delivery",
      description: "Delivery agent. Performs delivery evidence review, bounded simple repairs, and semantic accept/reject judgments; deterministic arbiter finalizes the delivery-stage verdict.",
      promptEditable: true,
      defaultPromptRequired: true,
    },
    orchestrator: {
      id: "orchestrator",
      description: "Orchestrator agent. Owns task lifecycle decisions and dispatches explicit workflow tools.",
      promptEditable: false,
      defaultPromptRequired: false,
    },
    requirements: {
      id: "requirements",
      description: "Requirements agent. Extracts user requirements and foundational technical decisions; it does not produce goals.",
      promptEditable: true,
      defaultPromptRequired: true,
    },
    architect: {
      id: "architect",
      description: "Architect agent. Owns the goal graph, traceability, assembly ownership, and cross-goal contracts.",
      promptEditable: true,
      defaultPromptRequired: true,
    },
    "design-analyst": {
      id: "design-analyst",
      description: "Design analyst agent. Converts visual/reference evidence into PRD and implementation constraints.",
      promptEditable: true,
      defaultPromptRequired: true,
    },
    "intent-analysis": {
      id: "intent-analysis",
      description: "Intent-analysis agent. Disambiguates the raw request into intent, complexity, slots, missing info, and clarifications.",
      promptEditable: true,
      defaultPromptRequired: true,
    },
    integrity: {
      id: "integrity",
      description: "Integrity reviewer. Audits requirement and goal integrity, including post-build requirement-status fidelity; it does not run delivery verification.",
      promptEditable: true,
      defaultPromptRequired: true,
    },
    prosecutor: {
      id: "prosecutor",
      description: "Prosecutor agent. Files adversarial counterexamples and diagnostic challenge metrics over delivery evidence; it cannot accept or reject delivery.",
      promptEditable: true,
      defaultPromptRequired: true,
    },
  }

  export function get(id: AgentRoleID): AgentRoleContract {
    return all[id]
  }

  export function description(id: AgentRoleID): string {
    return get(id).description
  }
}
