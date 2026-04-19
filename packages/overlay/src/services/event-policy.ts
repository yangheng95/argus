function hasPrefix(type: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => type.startsWith(prefix));
}

const TREE_WRITER_NOOP_TYPES = new Set([
  "task.heartbeat",
  "task.connected",
  "task-list.heartbeat",
  "task-list.connected",
  "server.heartbeat",
  "server.connected",
  "config.changed",
  "task.replay_expired",
  "agent.updated",
  "message.injected",
  "spec.created",
  "spec.updated",
  "spec.approved",
  "milestone.activated",
  "milestone.passed",
  "milestone.failed",
  // Fidelity `started` / `progress` are NOT noop — they promote a running
  // fidelity card so the operator sees the 60–180s review in flight instead
  // of a silent requirements session. Handled by tree-writer's
  // `handleFidelityStarted` / `handleFidelityProgress`; the same card id is
  // upserted by `handleFidelityCompleted` when the verdict lands.
])

/** Subagent phase-completion events. Each carries `sessionID` + `status`
 *  ("completed" | "error") and flips the owning session card out of its
 *  default `running` state. Added explicitly so the writer's
 *  `unhandled event type` guard doesn't mask them — these event types
 *  don't sit under any of the pass-through prefixes. */
const SUBAGENT_PHASE_COMPLETED_TYPES = new Set([
  "requirements.completed",
  "architect.completed",
  "design_analysis.completed",
]);

const TREE_WRITER_PASS_THROUGH_PREFIXES = [
  "run.",
  "plan.",
  "goal.",
  "delivery.",
  "evaluation.",
  "workflow.",
  "task.",
  "interaction.",
] as const;

const BOARD_INVALIDATING_EXACT_TYPES = new Set([
  "task.created",
  "task.updated",
  "task.completed",
  "task.failed",
  "task.cancelled",
  "task.blocked",
]);

const BOARD_INVALIDATING_PREFIXES = [
  "run.",
  "spec.",
  "milestone.",
  "plan.",
  "goal.",
  "delivery.",
  "evaluation.",
  "interaction.",
  "workflow.",
] as const;

const ROUTER_CONSUMED_NOOP_TYPES = new Set([
  "agent.updated",
  "message.injected",
]);

export function isTreeWriterNoopEventType(type: string): boolean {
  return TREE_WRITER_NOOP_TYPES.has(type);
}

export function isTreeWriterPassThroughEventType(type: string): boolean {
  return hasPrefix(type, TREE_WRITER_PASS_THROUGH_PREFIXES);
}

export function isSubagentPhaseCompletedEventType(type: string): boolean {
  return SUBAGENT_PHASE_COMPLETED_TYPES.has(type);
}

export function isBoardInvalidatingEventType(type: string): boolean {
  return BOARD_INVALIDATING_EXACT_TYPES.has(type) || hasPrefix(type, BOARD_INVALIDATING_PREFIXES);
}

export function isRouterConsumedNoopEventType(type: string): boolean {
  return ROUTER_CONSUMED_NOOP_TYPES.has(type);
}
