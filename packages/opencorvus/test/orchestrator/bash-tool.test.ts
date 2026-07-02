import { describe, expect, test } from "bun:test"
import {
  createOrchestratorTools,
  ORCHESTRATOR_BASH_DEFAULT_TIMEOUT_MS,
  ORCHESTRATOR_BASH_MAX_TIMEOUT_MS,
  validateOrchestratorBashCommand,
} from "../../src/orchestrator/tools"

/**
 * Orchestrator bash is the full runtime repair command surface. The prompt
 * carries the executor boundary; the host does not recreate the retired
 * git-only / single-invocation command gate.
 *
 * Spec — 2026-07-02 orchestrator-runtime-command-permission.
 */

describe("validateOrchestratorBashCommand — runtime command text", () => {
  test("accepts a plain git status command", () => {
    expect(validateOrchestratorBashCommand("git status")).toEqual({ ok: true })
  })

  test("accepts non-git commands", () => {
    expect(validateOrchestratorBashCommand("npm test")).toEqual({ ok: true })
    expect(validateOrchestratorBashCommand("node --version")).toEqual({
      ok: true,
    })
  })

  test("accepts the bare command form", () => {
    const result = validateOrchestratorBashCommand("date")
    expect(result.ok).toBe(true)
  })

  test("rejects empty / whitespace-only commands", () => {
    const a = validateOrchestratorBashCommand("")
    const b = validateOrchestratorBashCommand("   ")
    expect(a.ok).toBe(false)
    expect(b.ok).toBe(false)
  })

  test("accepts shell syntax needed for runtime repair", () => {
    expect(validateOrchestratorBashCommand("git status | head -5")).toEqual({ ok: true })
    expect(validateOrchestratorBashCommand("bun install && bun test packages/opencorvus/test/foo.test.ts")).toEqual({
      ok: true,
    })
    expect(validateOrchestratorBashCommand("git diff > out.patch")).toEqual({ ok: true })
    expect(validateOrchestratorBashCommand("node -e \"console.log(process.cwd())\"")).toEqual({ ok: true })
    expect(validateOrchestratorBashCommand("git status\nbun --version")).toEqual({ ok: true })
    expect(validateOrchestratorBashCommand("taskkill /IM bun.exe")).toEqual({ ok: true })
  })
})

describe("createOrchestratorTools — bash wiring", () => {
  test("uses a five minute default timeout with an explicit override ceiling", () => {
    expect(ORCHESTRATOR_BASH_DEFAULT_TIMEOUT_MS).toBe(300_000)
    expect(ORCHESTRATOR_BASH_MAX_TIMEOUT_MS).toBe(600_000)
  })

  test("exposes a `bash` tool entry", () => {
    const { tools } = createOrchestratorTools({
      taskID: "tsk_orchestrator_bash_fixture",
      agentSessionID: "ses_orchestrator_bash_fixture",
    })
    expect(tools).toHaveProperty("bash")
    const bash = (tools as Record<string, { description?: string }>).bash
    // Tool description must declare runtime repair scope and forbid replacing
    // executor surfaces. These phrases are load-bearing for prompt-level
    // discipline.
    expect(bash.description).toMatch(/Full runtime repair command shell/i)
    expect(bash.description).toMatch(/toolchain blockers/i)
    expect(bash.description).toMatch(/NOT a deliverable producer/)
    expect(bash.description).toMatch(/NOT a code authoring lane/)
    expect(bash.description).toMatch(/NOT a shortcut around requirements \/ architect \/ build/)
  })
})
