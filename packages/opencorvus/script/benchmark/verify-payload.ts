#!/usr/bin/env bun
// Verify per-goal payload invariants after a benchmark run.
// Usage:
//   bun run script/benchmark/verify-payload.ts tsk_d78397f1c001mHvcFp4khEvQfx

import path from "path"
import { loadBenchmarkEnv, prepareDashscopeEnv } from "./env"

const taskID = process.argv[2]
if (!taskID) {
  console.error("usage: verify-payload.ts <taskID>")
  process.exit(1)
}

await loadBenchmarkEnv(import.meta.dir)
prepareDashscopeEnv()

const { Instance } = await import("../../src/project/instance")
const { InstanceBootstrap } = await import("../../src/project/bootstrap")
const { compileBoard } = await import("../../src/workbench/board")

await Instance.provide({
  directory: path.resolve(import.meta.dir, "../.."),
  init: InstanceBootstrap,
  fn: async () => {
    const board = compileBoard({ taskID })

    const checks: Array<{ key: string; ok: boolean; detail: string }> = []
    const push = (key: string, ok: boolean, detail: string) =>
      checks.push({ key, ok, detail })

    const goalWorkflows = board.goalWorkflows ?? []
    push("goalWorkflows.length > 0", goalWorkflows.length > 0, `count=${goalWorkflows.length}`)

    for (const gw of goalWorkflows) {
      const gwID = gw.goalID.slice(-8)
      push(
        `goal[${gwID}].doneDefinition nonempty`,
        typeof gw.doneDefinition === "string" && gw.doneDefinition.length > 0,
        `len=${gw.doneDefinition?.length ?? 0}`,
      )
      push(
        `goal[${gwID}].steps[].length`,
        gw.steps.length > 0,
        `count=${gw.steps.length}`,
      )
      for (const step of gw.steps) {
        const label = `goal[${gwID}].step[${step.stepID}]`
        if (step.status !== "completed" && step.status !== "passed") continue
        if (step.stepID === "plan") {
          const n = step.payload?.planNodes?.length ?? 0
          push(`${label}.payload.planNodes nonempty`, n > 0, `count=${n}`)
        }
        if (step.stepID === "execute") {
          const n = step.payload?.changedFiles?.length ?? 0
          push(`${label}.payload.changedFiles nonempty`, n > 0, `count=${n}`)
          push(
            `${label}.payload.executorSessionID`,
            !!step.payload?.executorSessionID,
            String(step.payload?.executorSessionID ?? "null"),
          )
        }
        if (step.stepID === "eval") {
          const n = step.payload?.checks?.length ?? 0
          push(`${label}.payload.checks nonempty`, n > 0, `count=${n}`)
          push(
            `${label}.payload.verdict`,
            typeof step.payload?.verdict === "string" && step.payload.verdict.length > 0,
            step.payload?.verdict ?? "null",
          )
          push(
            `${label}.payload.evalSummary`,
            typeof step.payload?.evalSummary === "string" && step.payload.evalSummary.length > 0,
            `len=${step.payload?.evalSummary?.length ?? 0}`,
          )
        }
      }
    }

    console.log(`taskID=${taskID}`)
    console.log(`goalWorkflows=${goalWorkflows.length}`)
    console.log()
    for (const c of checks) {
      const mark = c.ok ? "\u2713" : "\u2717"
      console.log(`  ${mark} ${c.key.padEnd(60)} ${c.detail}`)
    }
    const passed = checks.filter((c) => c.ok).length
    const failed = checks.filter((c) => !c.ok).length
    console.log()
    console.log(`passed=${passed} failed=${failed}`)
    if (failed > 0) process.exit(1)
  },
})
