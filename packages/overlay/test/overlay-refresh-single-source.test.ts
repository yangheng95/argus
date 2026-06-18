import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

function src(path: string): string {
  return readFileSync(join(import.meta.dir, "..", "src", path), "utf8")
}

test("visible refresh hot path does not call the legacy message mirror", () => {
  const hotPath = ["services/events.ts", "services/chat.ts", "services/sync.ts"].map(src).join("\n")

  expect(hotPath).not.toContain("enqueueEvent(")
  expect(hotPath).not.toContain("ingestPersistedMessage(")
  expect(hotPath).not.toContain("loadConversation(")
  expect(hotPath).not.toContain("syncTask(")
  expect(hotPath).not.toContain("setMessages(")
})

test("event router production comments do not describe card-tree writes as legacy double-write", () => {
  const router = src("services/events.ts")
  expect(router).not.toContain("Double-write to the new cardTreeStore")
  expect(router).not.toContain("non-message legacy routing")
  expect(router).toContain("visible hot path")
})

test("SSE reconnect never restarts from stale cursor after hydrate failure", () => {
  expect(src("services/sse.ts")).not.toContain("deps.restart(deps.taskID, deps.after)")
})
