import { describe, expect, test } from "bun:test"
import path from "node:path"

/**
 * Pins the INFORMATION MISSING toggle wiring in `orchestrator/agent.ts`.
 *
 * Why a structural / regex test instead of behaviour: the orchestrator
 * deliberately bypasses `runAgentSession` (see file header in
 * `orchestrator/agent.ts`), composing its own two-part system prompt and
 * dispatching directly through `SessionPrompt.prompt`. That means the
 * fallback injection in `agent/runner.ts` does NOT reach the orchestrator;
 * the orchestrator must wire its own injection. Without this guard the
 * toggle silently no-ops on the orchestrator while the workers still
 * receive the fallback — debugging that asymmetry burns a full
 * benchmark run before the operator notices the orchestrator never
 * had the section in its trace.
 *
 * Spec — 2026-05-07 INFORMATION MISSING debug toggle, orchestrator-side
 * wiring fix discovered during the post-cleanup default-case benchmark.
 */
const orchestratorAgentPath = path.resolve(import.meta.dir, "../../src/orchestrator/agent.ts")

describe("orchestrator INFORMATION MISSING toggle wiring", () => {
  test("imports the single-source fallback constant", async () => {
    const text = await Bun.file(orchestratorAgentPath).text()
    expect(text).toMatch(
      /import\s*\{\s*INFORMATION_MISSING_FALLBACK_TEXT\s*\}\s*from\s*["']@\/prompt\/information-missing["']/,
    )
  })

  test("imports the detection helpers from agent/runner", async () => {
    const text = await Bun.file(orchestratorAgentPath).text()
    expect(text).toMatch(
      /import\s*\{[^}]*messageHasInformationMissing[^}]*extractInformationMissingBlock[^}]*\}\s*from\s*["']@\/agent\/runner["']/,
    )
  })

  test("reads the debug.fail_on_information_missing flag before composing the system prompt", async () => {
    const text = await Bun.file(orchestratorAgentPath).text()
    expect(text).toMatch(/EngineConfig\.get\(\)\)?\.debug/)
    expect(text).toMatch(/debugCfg\.fail_on_information_missing/)
  })

  test("conditionally pushes INFORMATION_MISSING_FALLBACK_TEXT onto the system array when toggle is on", async () => {
    const text = await Bun.file(orchestratorAgentPath).text()
    expect(text).toMatch(
      /if\s*\(debugCfg\.fail_on_information_missing\)\s*\{[\s\S]*?system\.push\(\s*INFORMATION_MISSING_FALLBACK_TEXT\s*\)/,
    )
  })

  test("calls process.exit(99) on detection of <INFORMATION MISSING> in the orchestrator's final message", async () => {
    const text = await Bun.file(orchestratorAgentPath).text()
    // Same fatal-signal contract as the worker path in agent/runner.ts.
    expect(text).toMatch(/messageHasInformationMissing\(finalMessage\)/)
    expect(text).toMatch(/extractInformationMissingBlock\(finalMessage\)/)
    expect(text).toMatch(/process\.exit\(99\)/)
  })

  test("logs the detection block via console.error and the structured logger before exiting", async () => {
    const text = await Bun.file(orchestratorAgentPath).text()
    expect(text).toMatch(/INFORMATION MISSING signal — terminating process/)
    expect(text).toMatch(/\[FATAL\] INFORMATION MISSING detected in orchestrator stream/)
  })
})
