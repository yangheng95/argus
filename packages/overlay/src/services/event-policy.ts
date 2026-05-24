function hasPrefix(type: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => type.startsWith(prefix))
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
  "task.live_replay_expired",
  "task.messages.changed",
  "agent.updated",
  "message.injected",
  "spec.created",
  "spec.updated",
  "spec.approved",
  "milestone.activated",
  "milestone.passed",
  "milestone.failed",
  // Integrity `started` / `progress` / `completed` are NOT noop —
  // started/progress promote a running integrity card, and completed upserts
  // it with the structured verdict. Handled by tree-writer's `handleIntegrity*`
  // family; the same card id (`integrity:<taskID>`) is upserted across all
  // three events.
])

const TREE_WRITER_PASS_THROUGH_PREFIXES = [
  "run.",
  "plan.",
  "goal.",
  "goal_run.",
  "evaluation.",
  "workflow.",
  "task.",
  "interaction.",
] as const

const TREE_WRITER_PASS_THROUGH_EXACT_TYPES = new Set(["delivery.ready", "delivery.evidence.updated"])

const BOARD_INVALIDATING_EXACT_TYPES = new Set([
  "task.created",
  "task.updated",
  "task.completed",
  "task.failed",
  "task.cancelled",
  "task.blocked",
])

const BOARD_INVALIDATING_PREFIXES = [
  "run.",
  "spec.",
  "milestone.",
  "plan.",
  "goal.",
  "goal_run.",
  "evaluation.",
  "interaction.",
  "workflow.",
] as const

const BOARD_INVALIDATING_EXACT_DELIVERY_TYPES = new Set(["delivery.ready", "delivery.evidence.updated"])

const ROUTER_CONSUMED_NOOP_TYPES = new Set(["agent.updated", "message.injected"])

export function isTreeWriterNoopEventType(type: string): boolean {
  return TREE_WRITER_NOOP_TYPES.has(type)
}

export function isTreeWriterPassThroughEventType(type: string): boolean {
  return TREE_WRITER_PASS_THROUGH_EXACT_TYPES.has(type) || hasPrefix(type, TREE_WRITER_PASS_THROUGH_PREFIXES)
}

export function isBoardInvalidatingEventType(type: string): boolean {
  return (
    BOARD_INVALIDATING_EXACT_TYPES.has(type) ||
    BOARD_INVALIDATING_EXACT_DELIVERY_TYPES.has(type) ||
    hasPrefix(type, BOARD_INVALIDATING_PREFIXES)
  )
}

export function isRouterConsumedNoopEventType(type: string): boolean {
  return ROUTER_CONSUMED_NOOP_TYPES.has(type)
}
