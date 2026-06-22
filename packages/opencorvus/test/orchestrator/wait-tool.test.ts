import { describe, expect, test } from "bun:test"
import {
  createOrchestratorTools,
  ORCHESTRATOR_WAIT_MAX_MS,
  ORCHESTRATOR_WAIT_MIN_MS,
} from "../../src/orchestrator/tools"
import { Agent } from "../../src/agent/agent"
import { ToolRegistry } from "../../src/tool/registry"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { ORCHESTRATOR_DECISION_EFFECT_METADATA_KEY } from "../../src/orchestrator/stateful-tool-names"

/**
 * Orchestrator `wait` is a one-shot deliberate pause for a NAMED external
 * event. These tests pin the bounds and behavior that the prompt's
 * "do not poll" discipline relies on so future edits cannot silently
 * loosen them.
 *
 * Spec — 2026-05-23 orchestrator-wait-tool.
 */

function toolFixtureInput() {
  return {
    taskID: "tsk_orchestrator_wait_fixture",
    agentSessionID: "ses_orchestrator_wait_fixture",
  }
}

function toolOptions() {
  const stamp = `${Date.now()}_${Math.random().toString(16).slice(2)}`
  return {
    toolCallId: `cal_wait_${stamp}`,
    opencorvus: {
      sessionID: `ses_wait_${stamp}`,
      messageID: `msg_wait_${stamp}`,
      toolCallID: `cal_wait_${stamp}`,
      toolPartID: `prt_wait_${stamp}`,
    },
  } as any
}

function toolOutput(result: unknown): string {
  if (typeof result === "string") return result
  if (result && typeof result === "object") {
    const output = (result as Record<string, unknown>).output
    if (typeof output === "string") return output
  }
  return String(result ?? "")
}

function toolMetadata(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== "object") return {}
  const metadata = (result as Record<string, unknown>).metadata
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {}
}

describe("createOrchestratorTools — wait wiring", () => {
  test("uses a one second floor and a ten minute ceiling", () => {
    expect(ORCHESTRATOR_WAIT_MIN_MS).toBe(1_000)
    expect(ORCHESTRATOR_WAIT_MAX_MS).toBe(600_000)
  })

  test("exposes a `wait` tool entry with the load-bearing discipline phrases", () => {
    const { tools } = createOrchestratorTools(toolFixtureInput())
    expect(tools).toHaveProperty("wait")
    const wait = (tools as Record<string, { description?: string }>).wait
    // The description carries prompt-level discipline. These phrases are
    // load-bearing — the orchestrator-core prompt cross-references them to
    // forbid polling and steer the LLM away from substituting `wait` for
    // `question` / `fail_task` / `read_context`.
    expect(wait.description).toMatch(/one-shot/i)
    expect(wait.description).toMatch(/NOT a polling primitive/i)
    expect(wait.description).toMatch(/external event/i)
    expect(wait.description).toMatch(/question/)
    expect(wait.description).toMatch(/fail_task/)
    expect(wait.description).toMatch(/read_context/)
  })

  test("mission and orchestrator agent tool surfaces expose wait", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const mission = await Agent.get("mission")
        const orchestrator = await Agent.get("orchestrator")
        expect(mission?.tools?.include).toContain("wait")
        expect(orchestrator?.tools?.include).toContain("wait")

        const missionTools = await ToolRegistry.tools({ providerID: "", modelID: "" }, mission)
        expect(missionTools.map((tool) => tool.id)).toContain("wait")
      },
    })
  })
})

describe("createOrchestratorTools — wait execute", () => {
  test("waits at least the requested duration before returning", async () => {
    const { tools } = createOrchestratorTools(toolFixtureInput())
    const requested = 1_200
    const startedAt = Date.now()
    const result = await (tools as any).wait.execute(
      { duration_ms: requested, reason: "external CI propagation" },
      toolOptions(),
    )
    const elapsed = Date.now() - startedAt
    const output = toolOutput(result)
    // setTimeout fires no earlier than the requested ms in Bun/Node. Allow
    // generous CI jitter on the upper bound; the floor is the load-bearing
    // assertion.
    expect(elapsed).toBeGreaterThanOrEqual(requested - 50)
    expect(output).toMatch(/^Waited \d+ms/)
    expect(output).toContain("external CI propagation")
    expect(output).toMatch(/read_context/)
    expect(toolMetadata(result)[ORCHESTRATOR_DECISION_EFFECT_METADATA_KEY]).toBe("observation")
  })

  test("returns immediately and reports `aborted` when the abort signal fires mid-wait", async () => {
    const controller = new AbortController()
    const { tools } = createOrchestratorTools({
      ...toolFixtureInput(),
      signal: controller.signal,
    })
    const requested = 60_000
    const startedAt = Date.now()
    const pending = (tools as any).wait.execute(
      { duration_ms: requested, reason: "remote queue draining" },
      toolOptions(),
    ) as Promise<unknown>
    // Fire abort on the next tick so the wait actually parks on setTimeout
    // first. Without the tick, an aborted-before-await path would short
    // circuit through the pre-loop `signal.aborted` branch instead of the
    // abort-listener cleanup we want to verify.
    setTimeout(() => controller.abort("test cancel"), 25)
    const result = await pending
    const elapsed = Date.now() - startedAt
    const output = toolOutput(result)
    expect(elapsed).toBeLessThan(requested / 2)
    expect(output).toMatch(/^wait aborted after \d+ms/)
    expect(output).toContain("remote queue draining")
    expect(toolMetadata(result)[ORCHESTRATOR_DECISION_EFFECT_METADATA_KEY]).toBe("observation")
  })

  test("short-circuits when the abort signal is already aborted before invocation", async () => {
    const controller = new AbortController()
    controller.abort("pre-aborted")
    const { tools } = createOrchestratorTools({
      ...toolFixtureInput(),
      signal: controller.signal,
    })
    const startedAt = Date.now()
    const result = await (tools as any).wait.execute(
      { duration_ms: 30_000, reason: "dev server warmup" },
      toolOptions(),
    )
    const elapsed = Date.now() - startedAt
    const output = toolOutput(result)
    expect(elapsed).toBeLessThan(500)
    expect(output).toMatch(/^wait aborted after \d+ms/)
    expect(toolMetadata(result)[ORCHESTRATOR_DECISION_EFFECT_METADATA_KEY]).toBe("observation")
  })
})
