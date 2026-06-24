/**
 * Public API barrel for the engine module.
 *
 * External callers import from "@/engine" — never from sub-modules directly.
 * Internal engine files may still use relative imports between siblings.
 */
export * from "./store"
export * from "./persist"
export * from "./state"
export * from "./helpers"
export * from "./model"
export * from "./config"
export * from "./protocol"
export * from "./workflow"
export * from "./catalog"
export * from "./orphan"
export * from "./task-status"
export * from "./agent-coordination"
export {
  EngineTaskTable,
  EngineGoalTable,
  EnginePlanVersionTable,
  EnginePlanNodeTable,
  EngineArtifactTable,
  EngineRequirementTable,
  EngineMilestoneTable,
  EngineProgressSnapshotTable,
  EngineInteractionRequestTable,
  EngineSpecSnapshotTable,
  EngineSpecItemTable,
  EngineChannelBindingTable,
} from "./engine.sql"
export type {
  EngineBudget,
  EngineMetadata,
  AcceptanceResult,
  EngineTaskStatus,
  EngineTaskPriority,
  EngineExecutor,
  EngineRunStatus,
  EngineRunPhase,
  EngineInteractionStatus,
  EngineArtifactKind,
  EngineAcceptanceStatus,
  EngineEvaluationStatus,
  EngineGoalRunStatus,
} from "./engine.sql"
