export type AgentRoleID =
  | "coding"
  | "coding-assistant"
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
  | "deep-research"
  | "frontend-research"
  | "goal-workload-analyst"

export type AgentArchetype = "host" | "worker"
export type AgentControlSurface = "host" | "primary" | "task-worker" | "helper"
export type PromptProfileTargetMode = "none" | "user" | "builtin"
export type AgentCoordinationRedispatchDispatcher =
  | "frontend_research_stage"
  | "frontend_design_stage"
  | "build_stage"
  | "intent_analysis_stage"
  | "explore_stage"
  | "workload_analysis_stage"
  | "fact_check_stage"
  | "deep_research_stage"
  | "requirements_stage"
  | "architect_stage"
  | "visual_qa_stage"
  | "integrity_stage"

export type OrchestratorWorkflowToolName =
  | "requirements"
  | "architect"
  | "frontend_design"
  | "frontend_research"
  | "deep_research"
  | "visual_qa"
  | "workload_analysis"
  | "analyze_intent"
  | "fact_check"
  | "build"
  | "explore"
  | "integrity"

export interface AgentCoordinationRedispatchBinding {
  dispatcher: AgentCoordinationRedispatchDispatcher
  stage: AgentRoleID
  target_kind: AgentRoleID
}

export interface AgentRoleContract {
  id: AgentRoleID
  archetype: AgentArchetype
  controlSurface: AgentControlSurface
  description: string
  promptEditable: boolean
  defaultPromptRequired: boolean
  promptConfigMode: "override" | "append" | "none"
  promptProfileTarget: PromptProfileTargetMode
  skillMountable: boolean
  agentOwnedSessionKind: boolean
  runtimeContractRequired: boolean
  exactRuntimeContract: boolean
  liveRuntimeContinuation: boolean
  protocolStageContinuation: boolean
  orchestratorWorkflowToolName: OrchestratorWorkflowToolName | null
  agentCoordinationRedispatchBinding: AgentCoordinationRedispatchBinding | null
  directSessionReply: boolean
  disableConfigurable: boolean
  nonExecutorSourceBoundaryExempt: boolean
  liveOrchestratorToolOwnershipControl: boolean
}

export namespace AgentRoleContract {
  export const all: Record<AgentRoleID, AgentRoleContract> = {
    coding: {
      id: "coding",
      archetype: "worker",
      controlSurface: "primary",
      description: "Direct coding assistant for ad hoc workspace edits outside the task workflow.",
      promptEditable: true,
      defaultPromptRequired: true,
      promptConfigMode: "override",
      promptProfileTarget: "user",
      skillMountable: false,
      agentOwnedSessionKind: false,
      runtimeContractRequired: false,
      exactRuntimeContract: false,
      liveRuntimeContinuation: false,
      protocolStageContinuation: false,
      orchestratorWorkflowToolName: null,
      agentCoordinationRedispatchBinding: null,
      directSessionReply: false,
      disableConfigurable: true,
      nonExecutorSourceBoundaryExempt: false,
      liveOrchestratorToolOwnershipControl: false,
    },
    "coding-assistant": {
      id: "coding-assistant",
      archetype: "worker",
      controlSurface: "primary",
      description:
        "Right-sidebar coding assistant session. Uses the project conversation panel and executes tools based on configured permissions.",
      promptEditable: true,
      defaultPromptRequired: true,
      promptConfigMode: "override",
      promptProfileTarget: "user",
      skillMountable: false,
      agentOwnedSessionKind: false,
      runtimeContractRequired: false,
      exactRuntimeContract: false,
      liveRuntimeContinuation: false,
      protocolStageContinuation: false,
      orchestratorWorkflowToolName: null,
      agentCoordinationRedispatchBinding: null,
      directSessionReply: false,
      disableConfigurable: true,
      nonExecutorSourceBoundaryExempt: false,
      liveOrchestratorToolOwnershipControl: false,
    },
    build: {
      id: "build",
      archetype: "worker",
      controlSurface: "task-worker",
      description:
        "General workflow executor. Produces one scoped task or goal deliverable through the build-core terminal-report contract.",
      promptEditable: true,
      defaultPromptRequired: true,
      promptConfigMode: "append",
      promptProfileTarget: "user",
      skillMountable: true,
      agentOwnedSessionKind: true,
      runtimeContractRequired: true,
      exactRuntimeContract: false,
      liveRuntimeContinuation: true,
      protocolStageContinuation: true,
      orchestratorWorkflowToolName: "build",
      agentCoordinationRedispatchBinding: { dispatcher: "build_stage", stage: "build", target_kind: "build" },
      directSessionReply: false,
      disableConfigurable: true,
      nonExecutorSourceBoundaryExempt: true,
      liveOrchestratorToolOwnershipControl: true,
    },
    "visual-qa": {
      id: "visual-qa",
      archetype: "worker",
      controlSurface: "task-worker",
      description:
        "Focused visual QA (Quality Assurance) agent. Uses browser/runtime evidence to test frontend GUI fidelity and observable functions, may repair in-scope defects, and reports reproducible visual and functional findings instead of relying on fixed screenshot baselines.",
      promptEditable: true,
      defaultPromptRequired: true,
      promptConfigMode: "append",
      promptProfileTarget: "user",
      skillMountable: true,
      agentOwnedSessionKind: true,
      runtimeContractRequired: true,
      exactRuntimeContract: true,
      liveRuntimeContinuation: true,
      protocolStageContinuation: true,
      orchestratorWorkflowToolName: "visual_qa",
      agentCoordinationRedispatchBinding: {
        dispatcher: "visual_qa_stage",
        stage: "visual-qa",
        target_kind: "visual-qa",
      },
      directSessionReply: false,
      disableConfigurable: true,
      nonExecutorSourceBoundaryExempt: true,
      liveOrchestratorToolOwnershipControl: false,
    },
    general: {
      id: "general",
      archetype: "worker",
      controlSurface: "task-worker",
      description: "General-purpose subagent for multi-step research and parallel work.",
      promptEditable: true,
      defaultPromptRequired: true,
      promptConfigMode: "override",
      promptProfileTarget: "user",
      skillMountable: false,
      agentOwnedSessionKind: false,
      runtimeContractRequired: false,
      exactRuntimeContract: false,
      liveRuntimeContinuation: false,
      protocolStageContinuation: false,
      orchestratorWorkflowToolName: null,
      agentCoordinationRedispatchBinding: null,
      directSessionReply: false,
      disableConfigurable: true,
      nonExecutorSourceBoundaryExempt: false,
      liveOrchestratorToolOwnershipControl: false,
    },
    explore: {
      id: "explore",
      archetype: "worker",
      controlSurface: "task-worker",
      description: "Read-oriented codebase exploration subagent for fast file, symbol, and code search.",
      promptEditable: true,
      defaultPromptRequired: true,
      promptConfigMode: "override",
      promptProfileTarget: "user",
      skillMountable: false,
      agentOwnedSessionKind: true,
      runtimeContractRequired: true,
      exactRuntimeContract: false,
      liveRuntimeContinuation: true,
      protocolStageContinuation: false,
      orchestratorWorkflowToolName: "explore",
      agentCoordinationRedispatchBinding: { dispatcher: "explore_stage", stage: "explore", target_kind: "explore" },
      directSessionReply: false,
      disableConfigurable: true,
      nonExecutorSourceBoundaryExempt: false,
      liveOrchestratorToolOwnershipControl: false,
    },
    compaction: {
      id: "compaction",
      archetype: "worker",
      controlSurface: "helper",
      description: "Internal summary agent for transcript checkpoint compaction.",
      promptEditable: false,
      defaultPromptRequired: false,
      promptConfigMode: "none",
      promptProfileTarget: "none",
      skillMountable: false,
      agentOwnedSessionKind: false,
      runtimeContractRequired: false,
      exactRuntimeContract: false,
      liveRuntimeContinuation: false,
      protocolStageContinuation: false,
      orchestratorWorkflowToolName: null,
      agentCoordinationRedispatchBinding: null,
      directSessionReply: false,
      disableConfigurable: true,
      nonExecutorSourceBoundaryExempt: false,
      liveOrchestratorToolOwnershipControl: false,
    },
    title: {
      id: "title",
      archetype: "worker",
      controlSurface: "helper",
      description: "Internal title agent for generating concise session titles.",
      promptEditable: true,
      defaultPromptRequired: true,
      promptConfigMode: "override",
      promptProfileTarget: "none",
      skillMountable: false,
      agentOwnedSessionKind: false,
      runtimeContractRequired: false,
      exactRuntimeContract: false,
      liveRuntimeContinuation: false,
      protocolStageContinuation: false,
      orchestratorWorkflowToolName: null,
      agentCoordinationRedispatchBinding: null,
      directSessionReply: false,
      disableConfigurable: true,
      nonExecutorSourceBoundaryExempt: false,
      liveOrchestratorToolOwnershipControl: false,
    },
    summary: {
      id: "summary",
      archetype: "worker",
      controlSurface: "helper",
      description: "Internal follow-up summary model-routing slot; its prompt is built by the caller.",
      promptEditable: false,
      defaultPromptRequired: false,
      promptConfigMode: "none",
      promptProfileTarget: "none",
      skillMountable: false,
      agentOwnedSessionKind: false,
      runtimeContractRequired: false,
      exactRuntimeContract: false,
      liveRuntimeContinuation: false,
      protocolStageContinuation: false,
      orchestratorWorkflowToolName: null,
      agentCoordinationRedispatchBinding: null,
      directSessionReply: false,
      disableConfigurable: true,
      nonExecutorSourceBoundaryExempt: false,
      liveOrchestratorToolOwnershipControl: false,
    },
    control: {
      id: "control",
      archetype: "worker",
      controlSurface: "primary",
      description: "Control-plane agent. Routes panel and gateway natural-language requests through the panel tool.",
      promptEditable: true,
      defaultPromptRequired: true,
      promptConfigMode: "override",
      promptProfileTarget: "none",
      skillMountable: false,
      agentOwnedSessionKind: false,
      runtimeContractRequired: false,
      exactRuntimeContract: false,
      liveRuntimeContinuation: false,
      protocolStageContinuation: false,
      orchestratorWorkflowToolName: null,
      agentCoordinationRedispatchBinding: null,
      directSessionReply: false,
      disableConfigurable: true,
      nonExecutorSourceBoundaryExempt: false,
      liveOrchestratorToolOwnershipControl: false,
    },
    orchestrator: {
      id: "orchestrator",
      archetype: "host",
      controlSurface: "host",
      description: "Orchestrator agent. Owns task lifecycle decisions and dispatches explicit workflow tools.",
      promptEditable: false,
      defaultPromptRequired: false,
      promptConfigMode: "none",
      promptProfileTarget: "builtin",
      skillMountable: false,
      agentOwnedSessionKind: true,
      runtimeContractRequired: true,
      exactRuntimeContract: false,
      liveRuntimeContinuation: false,
      protocolStageContinuation: false,
      orchestratorWorkflowToolName: null,
      agentCoordinationRedispatchBinding: null,
      directSessionReply: false,
      disableConfigurable: true,
      nonExecutorSourceBoundaryExempt: false,
      liveOrchestratorToolOwnershipControl: false,
    },
    mission: {
      id: "mission",
      archetype: "host",
      controlSurface: "primary",
      description:
        "Mission primary agent. Owns long-running user goals: intake and clarification, the mission contract and state, the roadmap, and reconciliation of delivered work. A full coordinator (reads/analyses the project, plans, delegates, summarises, asks the user) that delegates execution to orchestrator-led squad/team tasks rather than writing code itself.",
      promptEditable: true,
      defaultPromptRequired: true,
      promptConfigMode: "append",
      promptProfileTarget: "user",
      skillMountable: false,
      agentOwnedSessionKind: true,
      runtimeContractRequired: false,
      exactRuntimeContract: false,
      liveRuntimeContinuation: false,
      protocolStageContinuation: false,
      orchestratorWorkflowToolName: null,
      agentCoordinationRedispatchBinding: null,
      directSessionReply: false,
      disableConfigurable: true,
      nonExecutorSourceBoundaryExempt: false,
      liveOrchestratorToolOwnershipControl: false,
    },
    requirements: {
      id: "requirements",
      archetype: "worker",
      controlSurface: "task-worker",
      description:
        "Requirements agent. Extracts user requirements and foundational technical decisions; it does not produce goals.",
      promptEditable: true,
      defaultPromptRequired: true,
      promptConfigMode: "append",
      promptProfileTarget: "user",
      skillMountable: true,
      agentOwnedSessionKind: true,
      runtimeContractRequired: true,
      exactRuntimeContract: true,
      liveRuntimeContinuation: true,
      protocolStageContinuation: true,
      orchestratorWorkflowToolName: "requirements",
      agentCoordinationRedispatchBinding: {
        dispatcher: "requirements_stage",
        stage: "requirements",
        target_kind: "requirements",
      },
      directSessionReply: true,
      disableConfigurable: true,
      nonExecutorSourceBoundaryExempt: false,
      liveOrchestratorToolOwnershipControl: false,
    },
    architect: {
      id: "architect",
      archetype: "worker",
      controlSurface: "task-worker",
      description: "Architect agent. Owns the goal graph, traceability, assembly ownership, and cross-goal contracts.",
      promptEditable: true,
      defaultPromptRequired: true,
      promptConfigMode: "append",
      promptProfileTarget: "user",
      skillMountable: true,
      agentOwnedSessionKind: true,
      runtimeContractRequired: true,
      exactRuntimeContract: true,
      liveRuntimeContinuation: true,
      protocolStageContinuation: true,
      orchestratorWorkflowToolName: "architect",
      agentCoordinationRedispatchBinding: {
        dispatcher: "architect_stage",
        stage: "architect",
        target_kind: "architect",
      },
      directSessionReply: true,
      disableConfigurable: true,
      nonExecutorSourceBoundaryExempt: false,
      liveOrchestratorToolOwnershipControl: false,
    },
    "frontend-design": {
      id: "frontend-design",
      archetype: "worker",
      controlSurface: "task-worker",
      description:
        "Frontend design and webpage-replica agent. Single-shot task-scope evidence/handoff producer: dispatch it once to convert visual/reference evidence into the authoritative frontend implementation template, fillable modules, component inventory, material inventory, source handoff, and visual/data contracts; do not use it as a repeatable repair, retry, or implementation iteration agent after its handoff exists. For ainvest webpage rewrite work, generated code and PRD/SPEC/report material are reference inputs only; the rewritten webpage must be based on ainvest-frontend-design. It is not the owner for PRD/SPEC/report webpage research unless the requested deliverable is UI implementation or replication.",
      promptEditable: true,
      defaultPromptRequired: true,
      promptConfigMode: "append",
      promptProfileTarget: "user",
      skillMountable: true,
      agentOwnedSessionKind: true,
      runtimeContractRequired: true,
      exactRuntimeContract: true,
      liveRuntimeContinuation: true,
      protocolStageContinuation: true,
      orchestratorWorkflowToolName: "frontend_design",
      agentCoordinationRedispatchBinding: {
        dispatcher: "frontend_design_stage",
        stage: "frontend-design",
        target_kind: "frontend-design",
      },
      directSessionReply: true,
      disableConfigurable: true,
      nonExecutorSourceBoundaryExempt: false,
      liveOrchestratorToolOwnershipControl: false,
    },
    "intent-analysis": {
      id: "intent-analysis",
      archetype: "worker",
      controlSurface: "task-worker",
      description:
        "Intent-analysis agent. Disambiguates the raw request into intent, complexity, slots, missing info, and clarifications.",
      promptEditable: true,
      defaultPromptRequired: true,
      promptConfigMode: "append",
      promptProfileTarget: "user",
      skillMountable: true,
      agentOwnedSessionKind: true,
      runtimeContractRequired: true,
      exactRuntimeContract: true,
      liveRuntimeContinuation: true,
      protocolStageContinuation: true,
      orchestratorWorkflowToolName: "analyze_intent",
      agentCoordinationRedispatchBinding: {
        dispatcher: "intent_analysis_stage",
        stage: "intent-analysis",
        target_kind: "intent-analysis",
      },
      directSessionReply: true,
      disableConfigurable: true,
      nonExecutorSourceBoundaryExempt: false,
      liveOrchestratorToolOwnershipControl: false,
    },
    integrity: {
      id: "integrity",
      archetype: "worker",
      controlSurface: "task-worker",
      description:
        "Integrity reviewer. Audits requirement and goal integrity and produces session-bound pass or non-pass review reports, including runtime, frontend, visual, and rejection-detail evidence.",
      promptEditable: false,
      defaultPromptRequired: false,
      promptConfigMode: "none",
      promptProfileTarget: "builtin",
      skillMountable: true,
      agentOwnedSessionKind: true,
      runtimeContractRequired: true,
      exactRuntimeContract: false,
      liveRuntimeContinuation: true,
      protocolStageContinuation: true,
      orchestratorWorkflowToolName: "integrity",
      agentCoordinationRedispatchBinding: {
        dispatcher: "integrity_stage",
        stage: "integrity",
        target_kind: "integrity",
      },
      directSessionReply: true,
      disableConfigurable: true,
      nonExecutorSourceBoundaryExempt: true,
      liveOrchestratorToolOwnershipControl: false,
    },
    "fact-check": {
      id: "fact-check",
      archetype: "worker",
      controlSurface: "task-worker",
      description:
        "Fact-check agent. Verifies factual claims (APIs, library versions, numbers, paths, historical decisions) emitted by worker agents in their terminal report `fact_check_items[]`. Dispatched by the orchestrator after integrity pass; outputs structured verified/corrected/unresolved findings with evidence pointers.",
      promptEditable: true,
      defaultPromptRequired: true,
      promptConfigMode: "append",
      promptProfileTarget: "user",
      skillMountable: true,
      agentOwnedSessionKind: true,
      runtimeContractRequired: true,
      exactRuntimeContract: true,
      liveRuntimeContinuation: true,
      protocolStageContinuation: true,
      orchestratorWorkflowToolName: "fact_check",
      agentCoordinationRedispatchBinding: {
        dispatcher: "fact_check_stage",
        stage: "fact-check",
        target_kind: "fact-check",
      },
      directSessionReply: false,
      disableConfigurable: false,
      nonExecutorSourceBoundaryExempt: false,
      liveOrchestratorToolOwnershipControl: false,
    },
    "deep-research": {
      id: "deep-research",
      archetype: "worker",
      controlSurface: "task-worker",
      description:
        "Deep research agent. Read-only durable evidence gatherer for multi-source external facts, source maps, current documentation, API/industry research, PRD/SPEC/report source material, constraints, document outlines, and open questions. Dedicated webpage functional/visual investigation division belongs to frontend-research. Deep research never chooses routes or delivers final documents.",
      promptEditable: true,
      defaultPromptRequired: true,
      promptConfigMode: "append",
      promptProfileTarget: "user",
      skillMountable: true,
      agentOwnedSessionKind: true,
      runtimeContractRequired: true,
      exactRuntimeContract: true,
      liveRuntimeContinuation: true,
      protocolStageContinuation: true,
      orchestratorWorkflowToolName: "deep_research",
      agentCoordinationRedispatchBinding: {
        dispatcher: "deep_research_stage",
        stage: "deep-research",
        target_kind: "deep-research",
      },
      directSessionReply: false,
      disableConfigurable: false,
      nonExecutorSourceBoundaryExempt: false,
      liveOrchestratorToolOwnershipControl: false,
    },
    "frontend-research": {
      id: "frontend-research",
      archetype: "worker",
      controlSurface: "task-worker",
      description:
        "Frontend research agent. Source-page-scoped investigation publisher: dispatch one session per source page URL so the host can prepare rendered webpage evidence for that page, publish source-backed webpage investigation work packets, then emit a frontend_research_brief with an investigation-partition webpage_contract covering visible surfaces, component questions, layout/style checks, interaction/data checks, page interface verification, API adaptation documentation handoff cues, fidelity risks, document outlines, constraints, and open questions; do not reuse the same page scope as a repeatable crawler, repair, retry, or implementation iteration agent after its brief exists. Same source URL with a different focus, viewport, interaction state, component, region, fidelity risk, or missing-detail question is still the same page scope. For ainvest webpage rewrite work, any generated code snippets, PRD outline, or document material are reference inputs only; downstream webpage rewriting must be based on ainvest-frontend-design. It does not create the frontend implementation template, does not call build, and never chooses routes or delivers final documents.",
      promptEditable: true,
      defaultPromptRequired: true,
      promptConfigMode: "append",
      promptProfileTarget: "user",
      skillMountable: true,
      agentOwnedSessionKind: true,
      runtimeContractRequired: true,
      exactRuntimeContract: true,
      liveRuntimeContinuation: true,
      protocolStageContinuation: true,
      orchestratorWorkflowToolName: "frontend_research",
      agentCoordinationRedispatchBinding: {
        dispatcher: "frontend_research_stage",
        stage: "frontend-research",
        target_kind: "frontend-research",
      },
      directSessionReply: false,
      disableConfigurable: false,
      nonExecutorSourceBoundaryExempt: false,
      liveOrchestratorToolOwnershipControl: false,
    },
    "goal-workload-analyst": {
      id: "goal-workload-analyst",
      archetype: "worker",
      controlSurface: "task-worker",
      description:
        "Goal workload analyst. Read-only reviewer that deeply reads the full template and the architect goal graph, flags goals too large or under-specified for one autonomous build (decomposition_concern), and emits a per-goal execution inventory plus an anti-underestimation brief. References existing contract/coverage ids rather than restating them, and never creates or modifies goals.",
      promptEditable: true,
      defaultPromptRequired: true,
      promptConfigMode: "append",
      promptProfileTarget: "user",
      skillMountable: true,
      agentOwnedSessionKind: true,
      runtimeContractRequired: true,
      exactRuntimeContract: true,
      liveRuntimeContinuation: true,
      protocolStageContinuation: true,
      orchestratorWorkflowToolName: "workload_analysis",
      agentCoordinationRedispatchBinding: {
        dispatcher: "workload_analysis_stage",
        stage: "goal-workload-analyst",
        target_kind: "goal-workload-analyst",
      },
      directSessionReply: false,
      disableConfigurable: true,
      nonExecutorSourceBoundaryExempt: false,
      liveOrchestratorToolOwnershipControl: false,
    },
  }

  export const ids = Object.keys(all) as AgentRoleID[]

  export function get(id: AgentRoleID): AgentRoleContract {
    return all[id]
  }

  export function isRoleID(id: string): id is AgentRoleID {
    return Object.prototype.hasOwnProperty.call(all, id)
  }

  export function promptMode(id: AgentRoleID): AgentRoleContract["promptConfigMode"] {
    return all[id].promptConfigMode
  }

  export function promptProfileTargetMode(id: AgentRoleID): PromptProfileTargetMode {
    return get(id).promptProfileTarget
  }

  export function description(id: AgentRoleID): string {
    return get(id).description
  }

  export function archetype(id: AgentRoleID): AgentArchetype {
    return get(id).archetype
  }

  export function controlSurface(id: AgentRoleID): AgentControlSurface {
    return get(id).controlSurface
  }

  export function taskWorkerIDs(): AgentRoleID[] {
    return ids.filter((id) => get(id).controlSurface === "task-worker")
  }

  export function agentOwnedTaskWorkerIDs(): AgentRoleID[] {
    return taskWorkerIDs().filter((id) => get(id).agentOwnedSessionKind)
  }

  export function isAgentOwnedTaskWorkerID(id: string): id is AgentRoleID {
    return isRoleID(id) && get(id).controlSurface === "task-worker" && get(id).agentOwnedSessionKind
  }

  export function protocolStageContinuationIDs(): AgentRoleID[] {
    return taskWorkerIDs().filter((id) => get(id).protocolStageContinuation)
  }

  export function isProtocolStageContinuationID(id: string): id is AgentRoleID {
    return isRoleID(id) && get(id).protocolStageContinuation
  }

  export function agentCoordinationRedispatchIDs(): AgentRoleID[] {
    return taskWorkerIDs().filter((id) => get(id).agentCoordinationRedispatchBinding !== null)
  }

  export function agentCoordinationRedispatchBinding(id: AgentRoleID): AgentCoordinationRedispatchBinding | undefined {
    return get(id).agentCoordinationRedispatchBinding ?? undefined
  }

  export function orchestratorWorkflowToolName(id: AgentRoleID): OrchestratorWorkflowToolName | undefined {
    return get(id).orchestratorWorkflowToolName ?? undefined
  }

  export function directSessionReplyIDs(): AgentRoleID[] {
    return taskWorkerIDs().filter((id) => get(id).directSessionReply)
  }

  export function nonDisableConfigurableIDs(): AgentRoleID[] {
    return ids.filter((id) => !get(id).disableConfigurable)
  }

  export function isNonExecutorSourceBoundaryExempt(id: string): boolean {
    return isRoleID(id) && get(id).nonExecutorSourceBoundaryExempt
  }

  export function liveOrchestratorToolOwnershipControlIDs(): AgentRoleID[] {
    return ids.filter((id) => get(id).liveOrchestratorToolOwnershipControl)
  }

  export function usesLiveOrchestratorToolOwnershipControl(id: string): boolean {
    return isRoleID(id) && get(id).liveOrchestratorToolOwnershipControl
  }

  export function promptProfileTargets(mode?: PromptProfileTargetMode): AgentRoleID[] {
    return ids.filter((id) => (mode ? get(id).promptProfileTarget === mode : get(id).promptProfileTarget !== "none"))
  }

  export function skillMountable(id: AgentRoleID): boolean {
    return get(id).skillMountable
  }
}
