import { expect, test } from "bun:test"
import path from "node:path"
import {
  isBoardInvalidatingEventType,
  isTreeWriterKnownEventType,
  isTreeWriterPassThroughEventType,
} from "../src/services/event-policy"
;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test"

const { applyEvent, resetWriter } = await import("../src/services/tree-writer")
const { cardTreeStore } = await import("../src/store/card-tree")

const REPO_ROOT = path.resolve(import.meta.dir, "..", "..", "..")
const OPENAPI_PATH = path.join(REPO_ROOT, "packages", "sdk", "openapi.json")

async function loadProducerEventNames(): Promise<string[]> {
  const text = await Bun.file(OPENAPI_PATH).text()
  const spec = JSON.parse(text) as {
    components?: { schemas?: Record<string, unknown> }
  }
  const schemas = spec.components?.schemas ?? {}
  return Object.keys(schemas)
    .filter((key) => key.startsWith("Event."))
    .map((key) => key.slice("Event.".length))
    .sort()
}

test("tree-writer classifies every OpenAPI-declared event type", async () => {
  const unknown = (await loadProducerEventNames()).filter((type) => !isTreeWriterKnownEventType(type))
  expect(unknown).toEqual([])
})

test("retired bogus event types remain unknown", () => {
  expect(isTreeWriterKnownEventType("interaction.created")).toBe(false)
  expect(isTreeWriterKnownEventType("acceptance.gate.rejected")).toBe(false)
  expect(isTreeWriterKnownEventType("acceptance.review.completed")).toBe(false)
})

test("agent coordination events are visible pass-through board invalidations", () => {
  for (const type of [
    "agent.coordination.requested",
    "agent.coordination.responded",
    "agent.coordination.cancelled",
    "agent.coordination.action",
  ]) {
    expect(isTreeWriterKnownEventType(type)).toBe(true)
    expect(isTreeWriterPassThroughEventType(type)).toBe(true)
    expect(isBoardInvalidatingEventType(type)).toBe(true)
  }
})

test("task lifecycle fact events are visible pass-through board invalidations", () => {
  expect(isTreeWriterKnownEventType("task.lifecycle")).toBe(true)
  expect(isTreeWriterPassThroughEventType("task.lifecycle")).toBe(true)
  expect(isBoardInvalidatingEventType("task.lifecycle")).toBe(true)
})

test("declared non-card control events are explicit tree-writer no-ops", () => {
  resetWriter()
  for (const type of [
    "mcp.tools.changed",
    "mcp.auth.required",
    "mcp.browser.open.failed",
    "pty.created",
    "pty.updated",
    "pty.exited",
    "pty.deleted",
    "task_plan.updated",
    "todo.updated",
    "session.compacted",
    "session.bridge.persist_failed",
    "worktree.ready",
    "workspace.failed",
  ]) {
    applyEvent({
      type,
      emittedAt: 1_780_600_000_000,
      properties: { sessionID: "ses_control", summary: type },
    })
  }

  expect(cardTreeStore.order).toEqual([])
  expect(Object.keys(cardTreeStore.cards)).toEqual([])
})
