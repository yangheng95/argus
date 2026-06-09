/**
 * Coverage guard for InteractionDialogHost — the modal that pops the oldest
 * pending permission/question interaction so the user can't lose the answer
 * surface in the conversation timeline / sidebar.
 *
 * Two layers (per project rule 36):
 *   1. Behaviour test for `pickDialogInteraction` — the queue / dismiss
 *      selector that decides which interaction the dialog shows.
 *   2. Adoption guard — the host is registered in main.tsx alongside the
 *      other dialog hosts, and reuses <InteractionCard> as the body (single
 *      source for interaction rendering, rules 8 / 9).
 */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { pickDialogInteraction } from "../src/components/InteractionDialogHost"
import type { InteractionData } from "../src/components/InteractionCard"

const OVERLAY_ROOT = join(import.meta.dir, "../")
const MAIN_SOURCE = join(OVERLAY_ROOT, "src/main.tsx")
const HOST_SOURCE = join(OVERLAY_ROOT, "src/components/InteractionDialogHost.tsx")

function readText(path: string): string {
  return readFileSync(path, "utf8")
}

function makeInteraction(partial: Partial<InteractionData> & { id: string; createdAt?: number }): InteractionData {
  const { createdAt = 0, ...rest } = partial
  return {
    id: rest.id,
    type: rest.type ?? "question",
    status: rest.status ?? "pending",
    title: rest.title,
    body: rest.body,
    payload: rest.payload,
    // tree-writer/board both attach `time.created` to interactions; we mirror
    // that shape so the selector exercises the real path.
    ...({ time: { created: createdAt } } as object),
  } as InteractionData
}

describe("pickDialogInteraction", () => {
  test("returns null when there is no pending interaction", () => {
    expect(pickDialogInteraction([], new Set())).toBeNull()
    expect(pickDialogInteraction(null, new Set())).toBeNull()
    expect(pickDialogInteraction(undefined, new Set())).toBeNull()
    expect(pickDialogInteraction([makeInteraction({ id: "a", status: "answered" })], new Set())).toBeNull()
  })

  test("picks the oldest pending interaction by time.created", () => {
    const list = [
      makeInteraction({ id: "newer", createdAt: 200 }),
      makeInteraction({ id: "older", createdAt: 100 }),
      makeInteraction({ id: "newest", createdAt: 300 }),
    ]
    expect(pickDialogInteraction(list, new Set())?.id).toBe("older")
  })

  test("skips dismissed interactions and falls through to the next pending one", () => {
    const list = [makeInteraction({ id: "older", createdAt: 100 }), makeInteraction({ id: "newer", createdAt: 200 })]
    expect(pickDialogInteraction(list, new Set(["older"]))?.id).toBe("newer")
    expect(pickDialogInteraction(list, new Set(["older", "newer"]))).toBeNull()
  })

  test("ignores non-permission/question interaction types", () => {
    const list = [
      makeInteraction({ id: "weird", type: "clarification" as any, createdAt: 50 }),
      makeInteraction({ id: "real", type: "permission", createdAt: 80 }),
    ]
    expect(pickDialogInteraction(list, new Set())?.id).toBe("real")
  })

  test("handles permissions just like questions", () => {
    const list = [
      makeInteraction({ id: "perm", type: "permission", createdAt: 10 }),
      makeInteraction({ id: "q", type: "question", createdAt: 20 }),
    ]
    expect(pickDialogInteraction(list, new Set())?.id).toBe("perm")
  })
})

describe("InteractionDialogHost — wiring", () => {
  test("host is registered in main.tsx alongside the other dialog hosts", () => {
    const main = readText(MAIN_SOURCE)
    expect(main).toContain('import { InteractionDialogHost } from "./components/InteractionDialogHost"')
    expect(main).toContain("<InteractionDialogHost />")
    expect(main).toContain('interactionDialogHost.id = "interactionDialogHost"')
  })

  test("host renders the shared <InteractionCard> (single source for interaction UI)", () => {
    const source = readText(HOST_SOURCE)
    expect(source).toContain("InteractionCard")
    expect(source).toContain("<InteractionCard")
    expect(source).toContain("<Dialog")
  })
})
