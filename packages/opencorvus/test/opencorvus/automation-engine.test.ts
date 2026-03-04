import { describe, expect, test } from "bun:test"
import { Automation } from "../../src/opencorvus/automation/engine"

function ok<T>(data?: T): Automation.Probe<T> {
  return { ok: true, data }
}

function bad(kind: Automation.ErrorKind, detail: string): Automation.Probe {
  return { ok: false, kind, detail }
}

describe("automation engine", () => {
  test("runs locate -> pre -> act -> post in one attempt", async () => {
    const calls: string[] = []
    const driver: Automation.Driver = {
      locate: async () => {
        calls.push("locate")
        return ok({ id: "save" })
      },
      check: async (input) => {
        calls.push(`${input.stage}:${input.check.kind}`)
        return ok()
      },
      act: async () => {
        calls.push("act")
        return ok()
      },
      snapshot: async (input) => ({ id: `${input.label}:${input.attempt}` }),
    }
    const engine = Automation.create(driver, {
      timeoutMs: 20,
      intervalMs: 0,
      retryMax: 1,
      backoffMs: [0],
    })

    const result = await engine.run({
      id: "save-doc",
      target: [{ kind: "role", value: "button", name: "Save" }],
      pre: [{ kind: "visible" }],
      act: { kind: "click" },
      post: [{ kind: "state", key: "saved", value: true }],
    })

    expect(result.ok).toBe(true)
    expect(result.tries).toBe(1)
    expect(calls).toEqual(["locate", "pre:visible", "act", "post:state"])
    expect(result.trace.some((x) => x.stage === "snapshot" && x.shot === "ok:1")).toBe(true)
  })

  test("retries once and runs recovery after action failure", async () => {
    let actCount = 0
    let recoverCount = 0
    const driver: Automation.Driver = {
      locate: async () => ok({ id: "submit" }),
      check: async () => ok(),
      act: async () => {
        actCount++
        if (actCount === 1) return bad("not_interactable", "covered by modal")
        return ok()
      },
      recover: async () => {
        recoverCount++
        return ok()
      },
    }
    const engine = Automation.create(driver, {
      timeoutMs: 20,
      intervalMs: 0,
      retryMax: 2,
      backoffMs: [0, 0],
    })

    const result = await engine.run({
      id: "submit",
      target: [{ kind: "aid", value: "submit-btn" }],
      act: { kind: "click" },
    })

    expect(result.ok).toBe(true)
    expect(result.tries).toBe(2)
    expect(recoverCount).toBe(1)
    expect(result.trace.some((x) => x.stage === "recover" && x.ok)).toBe(true)
  })

  test("returns not_found when locator never resolves", async () => {
    let locateCount = 0
    const driver: Automation.Driver = {
      locate: async () => {
        locateCount++
        return bad("not_found", "no node")
      },
      check: async () => ok(),
      act: async () => ok(),
    }
    const engine = Automation.create(driver, {
      timeoutMs: 5,
      intervalMs: 0,
      retryMax: 1,
      backoffMs: [0],
    })

    const result = await engine.run({
      id: "missing",
      target: [{ kind: "text", value: "Missing" }],
      act: { kind: "click" },
    })

    expect(result.ok).toBe(false)
    expect(result.kind).toBe("not_found")
    expect(result.tries).toBe(1)
    expect(locateCount).toBeGreaterThan(0)
  })

  test("runAll stops at first failure by default", async () => {
    const calls: string[] = []
    const driver: Automation.Driver = {
      locate: async () => ok({ id: "node" }),
      check: async () => ok(),
      act: async (input) => {
        calls.push(input.step.id)
        if (input.step.id === "b") return bad("infra", "session gone")
        return ok()
      },
    }
    const engine = Automation.create(driver, {
      timeoutMs: 20,
      intervalMs: 0,
      retryMax: 1,
      backoffMs: [0],
    })

    const flow = await engine.runAll([
      { id: "a", act: { kind: "hotkey", keys: ["ctrl", "l"] } },
      { id: "b", act: { kind: "custom", name: "open" } },
      { id: "c", act: { kind: "wait", ms: 1 } },
    ])

    expect(flow.ok).toBe(false)
    expect(flow.steps.map((x) => x.id)).toEqual(["a", "b"])
    expect(calls).toEqual(["a", "b"])
  })
})

