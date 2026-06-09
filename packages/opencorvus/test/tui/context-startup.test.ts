import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const tuiRoot = path.join(import.meta.dir, "../../src/cli/cmd/tui")

function source(file: string) {
  return readFileSync(path.join(tuiRoot, file), "utf8")
}

describe("tui context startup", () => {
  test("keeps provider readiness reactive so async TUI styles and children mount", () => {
    const helper = source("context/helper.tsx")

    expect(helper).toContain("const isReady = () =>")
    expect(helper).toContain("<Show when={isReady()}>")
    expect(helper).not.toContain("<Show when={ready}>")
  })

  test("initializes KV storage to an object before async disk reads complete", () => {
    const kv = source("context/kv.tsx")

    expect(kv).toContain("createStore<Record<string, any>>({})")
    expect(kv).not.toContain("createStore<Record<string, any>>()")
  })

  test("does not block first TUI paint on provider catalog requests", () => {
    const sync = source("context/sync.tsx")
    const blocking = sync.match(/const blockingRequests: Promise<unknown>\[\] = \[[\s\S]*?\n      \]/)?.[0] ?? ""

    expect(blocking).toContain("agentsPromise")
    expect(blocking).toContain("configPromise")
    expect(blocking).not.toContain("providersPromise")
    expect(blocking).not.toContain("providerListPromise")
    expect(sync).toContain("providersPromise.then((providers) =>")
    expect(sync).toContain("providerListPromise.then((providers) =>")
  })

  test("allows explicit hidden TUI agent selection without polluting the visible list", () => {
    const local = source("context/local.tsx")

    expect(local).toContain(
      'const selectableAgents = createMemo(() => sync.data.agent.filter((x) => x.mode !== "subagent"))',
    )
    expect(local).toContain("const agents = createMemo(() => selectableAgents().filter((x) => !x.hidden))")
    expect(local).toContain(
      "const selected = createMemo(() => selectableAgents().find((x) => x.name === agentStore.current))",
    )
    expect(local).toContain("if (!selectableAgents().some((x) => x.name === name))")
    expect(local).not.toContain("agents()[0].name")
  })

  test("waits for provider data before validating configured agent models", () => {
    const local = source("context/local.tsx")

    expect(local).toContain("if (sync.data.provider.length === 0) return")
    expect(local).toContain("return sync.ready && !!agent.selected()")
  })
})
