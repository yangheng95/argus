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
  "session.created",
  "session.updated",
  "session.deleted",
  "session.diff",
  "task.replay_expired",
  "task.live_replay_expired",
  "task.messages.changed",
  "agent.updated",
  "message.injected",
  "command.executed",
  "spec.created",
  "spec.updated",
  "spec.approved",
  "milestone.activated",
  "milestone.passed",
  "milestone.failed",
  "global.disposed",
  "server.instance.disposed",
  "installation.updated",
  "installation.update-available",
  "project.updated",
  "pty.created",
  "pty.updated",
  "pty.exited",
  "pty.deleted",
  "lsp.client.diagnostics",
  "lsp.updated",
  "mcp.tools.changed",
  "mcp.auth.required",
  "mcp.browser.open.failed",
  "mcp.prompts.changed",
  "mcp.resources.changed",
  "task-queue.completed",
  "task.report",
  "file.watcher.updated",
  "vcs.branch.updated",
  "worktree.ready",
  "worktree.failed",
  "task_plan.updated",
  "session.compacted",
  "file.edited",
  "workspace.ready",
  "workspace.failed",
  "todo.updated",
  // Integrity `started` / `progress` / `completed` are NOT noop —
  // started/progress promote a running integrity card, and completed upserts
  // it with the structured verdict. Handled by tree-writer's `handleIntegrity*`
  // family; the same card id (`integrity:<taskID>`) is upserted across all
  // three events.
])

const TREE_WRITER_PASS_THROUGH_PREFIXES = [] as const

const TREE_WRITER_PASS_THROUGH_EXACT_TYPES = new Set([
  "run.created",
  "run.updated",
  "run.progress",
  "run.output",
  "plan.created",
  "plan.activated",
  "goal.progress",
  "goal_run.updated",
  "goal.passed",
  "goal.failed",
  "goal.workflow.progress",
  "goal.report",
  "evaluation.completed",
  "workflow.selected",
  "workflow.step.updated",
  "task.failed",
  "task.cancelled",
  "task.blocked",
  "task.rewound",
  "task.message",
  "agent.coordination.requested",
  "agent.coordination.responded",
  "agent.coordination.cancelled",
  "acceptance.ready",
  "acceptance.evidence.updated",
])

const TREE_WRITER_PROJECTED_EXACT_TYPES = new Set([
  "message.part.delta",
  "task.created",
  "task.updated",
  "task.completed",
  "goal.created",
  "interaction.requested",
  "interaction.resolved",
  "question.asked",
  "question.replied",
  "question.rejected",
  "message.updated",
  "message.part.updated",
  "message.removed",
  "message.part.removed",
  "review.stream.started",
  "review.stream.progress",
  "review.stream.chunk",
  "integrity.review.completed",
  "session.status",
  "session.error",
  "session.idle",
  "approval.request",
  "input.request",
  "permission.asked",
  "permission.replied",
  "diff.delta",
])

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
  "agent.coordination.",
] as const

const BOARD_INVALIDATING_EXACT_ACCEPTANCE_TYPES = new Set(["acceptance.ready", "acceptance.evidence.updated"])

const ROUTER_CONSUMED_NOOP_TYPES = new Set(["agent.updated", "message.injected", "session.diff"])

export function isTreeWriterNoopEventType(type: string): boolean {
  return TREE_WRITER_NOOP_TYPES.has(type)
}

export function isTreeWriterPassThroughEventType(type: string): boolean {
  return TREE_WRITER_PASS_THROUGH_EXACT_TYPES.has(type) || hasPrefix(type, TREE_WRITER_PASS_THROUGH_PREFIXES)
}

export function isTreeWriterKnownEventType(type: string): boolean {
  return (
    TREE_WRITER_PROJECTED_EXACT_TYPES.has(type) ||
    isTreeWriterNoopEventType(type) ||
    isTreeWriterPassThroughEventType(type)
  )
}

export function isBoardInvalidatingEventType(type: string): boolean {
  return (
    BOARD_INVALIDATING_EXACT_TYPES.has(type) ||
    BOARD_INVALIDATING_EXACT_ACCEPTANCE_TYPES.has(type) ||
    hasPrefix(type, BOARD_INVALIDATING_PREFIXES)
  )
}

export function isRouterConsumedNoopEventType(type: string): boolean {
  return ROUTER_CONSUMED_NOOP_TYPES.has(type)
}
