import { describe, expect, test } from "bun:test"
import {
  createOrchestratorTools,
  ORCHESTRATOR_BASH_DEFAULT_TIMEOUT_MS,
  ORCHESTRATOR_BASH_MAX_TIMEOUT_MS,
  validateOrchestratorBashCommand,
} from "../../src/orchestrator/tools"

/**
 * Orchestrator bash is the user-authorized single-command evidence surface.
 * The prompt carries authorization scope; the host enforces command-shape
 * safety. These tests pin the schema-level invariants so they cannot regress
 * silently.
 *
 * Spec — 2026-06-15 user-authorized-mission-orchestrator-bash.
 */

describe("validateOrchestratorBashCommand — single invocation only", () => {
  test("accepts a plain git status", () => {
    expect(validateOrchestratorBashCommand("git status")).toEqual({ ok: true })
  })

  test("accepts non-git single commands", () => {
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

  test("rejects pipelines", () => {
    const result = validateOrchestratorBashCommand("git status | head -5")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/pipeline/)
  })

  test("rejects chained commands (&&, ||)", () => {
    const a = validateOrchestratorBashCommand("git add . && git commit")
    const b = validateOrchestratorBashCommand("git pull || git status")
    expect(a.ok).toBe(false)
    expect(b.ok).toBe(false)
    if (!a.ok) expect(a.reason).toMatch(/chain/)
    if (!b.ok) expect(b.reason).toMatch(/chain/)
  })

  test("rejects command separators (;)", () => {
    const result = validateOrchestratorBashCommand("git status; git diff")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/separator/)
  })

  test("rejects backgrounding (&)", () => {
    const result = validateOrchestratorBashCommand("git fetch &")
    expect(result.ok).toBe(false)
  })

  test("rejects redirections (> / >> / <)", () => {
    expect(validateOrchestratorBashCommand("git diff > out.patch").ok).toBe(false)
    expect(validateOrchestratorBashCommand("git log >> log.txt").ok).toBe(false)
    expect(validateOrchestratorBashCommand("git apply < patch.diff").ok).toBe(false)
  })

  test("rejects command substitution ($(...) and backticks)", () => {
    const a = validateOrchestratorBashCommand("git reset --hard $(git merge-base HEAD main)")
    const b = validateOrchestratorBashCommand("git checkout `git merge-base HEAD main`")
    expect(a.ok).toBe(false)
    expect(b.ok).toBe(false)
    if (!a.ok) expect(a.reason).toMatch(/substitution/)
    if (!b.ok) expect(b.reason).toMatch(/substitution/)
  })

  test("rejects process-killing patterns", () => {
    // Defense in depth: even if someone uses an otherwise valid command, the
    // host-killing detector catches `pkill` / `taskkill` / etc.
    const result = validateOrchestratorBashCommand("pkill bun")
    expect(result.ok).toBe(false)
  })

  test("rejects embedded newlines / carriage returns (shell command separators)", () => {
    expect(validateOrchestratorBashCommand("git status\nrm -rf /tmp").ok).toBe(false)
    expect(validateOrchestratorBashCommand("git diff\r\nrm foo").ok).toBe(false)
  })

  test("rejects an embedded `taskkill /IM` even inside a git argument", () => {
    const result = validateOrchestratorBashCommand("git diff -- taskkill /IM bun.exe")
    // host-killing pattern is a regex, fires on the substring.
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.reason).toMatch(/host-process-killing|substitution|separator|pipeline|chain|redirection/)
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
    // Tool description must declare the user-authorized scope and forbid replacing
    // sub-agent surfaces — these phrases are load-bearing for prompt-level
    // discipline.
    expect(bash.description).toMatch(/User-authorized/i)
    expect(bash.description).toMatch(/single-command/i)
    expect(bash.description).toMatch(/NOT a code editor/)
    expect(bash.description).toMatch(/NOT an autonomous test runner/)
  })
})
