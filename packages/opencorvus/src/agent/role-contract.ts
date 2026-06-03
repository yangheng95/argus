export type AgentRoleID =
  | "coding"
  | "build"
  | "visual-qa"
  | "general"
  | "explore"
  | "compaction"
  | "title"
  | "summary"
  | "control"
  | "orchestrator"
  | "mission"
  | "requirements"
  | "architect"
  | "frontend-design"
  | "intent-analysis"
  | "integrity"
  | "fact-check"
  | "research"
  | "frontend-research"
  | "goal-workload-analyst"

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
      description: "General workflow executor. Produces one scoped task or goal deliverable through the build-core terminal-report contract.",
      promptEditable: true,
      defaultPromptRequired: true,
      promptConfigMode: "append",
    },
    "visual-qa": {
      id: "visual-qa",
      description:
        "Full-function visual QA agent. Uses browser/runtime evidence to test frontend visual quality, may repair defects like build, and reports reproducible visual findings instead of relying on fixed screenshot baselines.",
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
      promptEditable: false,
      defaultPromptRequired: false,
      promptConfigMode: "none",
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
    mission: {
      id: "mission",
      description:
        "Mission primary agent. Owns long-running user goals: intake and clarification, the mission contract and state, the roadmap, and reconciliation of delivered work. A full coordinator (reads/analyses the project, plans, delegates, summarises, asks the user) that delegates execution to orchestrator-led squad/team tasks rather than writing code itself.",
      promptEditable: true,
      defaultPromptRequired: true,
      promptConfigMode: "append",
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
    "frontend-design": {
      id: "frontend-design",
      description: "Frontend design and webpage-replica agent. Converts visual/reference evidence into the authoritative frontend implementation template, fillable modules, component inventory, material inventory, source handoff, and visual/data contracts. It is not the owner for PRD/SPEC/report webpage research unless the requested deliverable is UI implementation or replication.",
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
    research: {
      id: "research",
      description:
        "Research agent. Read-only advisory evidence gatherer for external facts, source maps, current documentation, PRD/SPEC/report source material, constraints, document outlines, and open questions. Dedicated webpage functional/visual PRD evidence belongs to frontend-research. Research never chooses routes or delivers final documents.",
      promptEditable: true,
      defaultPromptRequired: true,
      promptConfigMode: "append",
    },
    "frontend-research": {
      id: "frontend-research",
      description:
        "Frontend research agent. Directly performs read-only webpage functional and visual research from prepared evidence and source retrieval, then emits a source-backed frontend_research_brief with webpage_contract covering functions, layout, styles, interactions, content inventory, fidelity acceptance, risks, document outlines, constraints, and open questions. It does not create the frontend implementation template, does not call build, and never chooses routes or delivers final documents.",
      promptEditable: true,
      defaultPromptRequired: true,
      promptConfigMode: "append",
    },
    "goal-workload-analyst": {
      id: "goal-workload-analyst",
      description:
        "Goal workload analyst. Read-only reviewer that deeply reads the full template and the architect goal graph, flags goals too large or under-specified for one autonomous build (decomposition_concern), and emits a per-goal execution inventory plus an anti-underestimation brief. References existing contract/coverage ids rather than restating them, and never creates or modifies goals.",
      promptEditable: true,
      defaultPromptRequired: true,
      promptConfigMode: "append",
    },
  }

  export function get(id: AgentRoleID): AgentRoleContract {
    return all[id]
  }

  export function promptMode(id: AgentRoleID): AgentRoleContract["promptConfigMode"] {
    return all[id].promptConfigMode
  }

  export function description(id: AgentRoleID): string {
    return get(id).description
  }
}
