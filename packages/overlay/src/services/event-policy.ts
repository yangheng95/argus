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
  // Fidelity review lifecycle markers — emitted by requirements/fidelity.ts
  // purely to keep the SSE stream alive while the non-streaming verdict LLM
  // runs (60–180s). The overlay renders the verdict via fidelity.review.completed;
  // started/progress carry no payload the user needs.
  "fidelity.review.started",
  "fidelity.review.progress",
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

export function isBoardInvalidatingEventType(type: string): boolean {
  return BOARD_INVALIDATING_EXACT_TYPES.has(type) || hasPrefix(type, BOARD_INVALIDATING_PREFIXES);
}

export function isRouterConsumedNoopEventType(type: string): boolean {
  return ROUTER_CONSUMED_NOOP_TYPES.has(type);
}
