#!/usr/bin/env bun
/**
 * 验证 hexin provider 加载 + evaluator JSON 修复
 */
import { generateObject } from "ai"
import z from "zod"
import path from "path"
import os from "os"
import fs from "fs/promises"

const { loadBenchmarkEnv, prepareDashscopeEnv } = await import("./env")
const { Log } = await import("../../src/util/log")
Log.init({ print: false })
const { Instance } = await import("../../src/project/instance")
const { InstanceBootstrap } = await import("../../src/project/bootstrap")
const { Provider } = await import("../../src/provider/provider")

await loadBenchmarkEnv(import.meta.dir)
prepareDashscopeEnv()

const EvaluatorAnalysis = z.object({
  verdict: z.enum(["accepted", "rejected", "inconclusive"]),
  classification: z.enum(["transient", "environment", "input", "permission", "evaluation", "strategy", "unknown"]),
  summary: z.string(),
  goal_statuses: z.array(z.object({
    goal_index: z.number(),
    status: z.enum(["passed", "failed", "inconclusive"]),
    evidence: z.string(),
    reasoning: z.string(),
  })),
  replan_guidance: z.object({
    root_cause: z.string(),
    what_failed: z.string(),
    suggested_strategy: z.string(),
    avoid_approaches: z.array(z.string()),
  }).nullish(),
})

const JUDGMENT_SYSTEM = `You are the judgment phase for OpenCorvus's evaluator.
You receive a detailed investigation report and must produce a structured verdict. No tools available.`

// 模拟修复后的 buildJudgmentPrompt 输出（包含 JSON Output Format section）
const PROMPT = `# Task

Title: Test NoteStore
Request: Implement NoteStore

# Goals (1)

0. [blocking] Implement NoteStore — Criteria: tests pass

# Automated Check Results

[PASS] bun test

# Investigation Findings

All tests pass. src/note-store.ts implements NoteStore class. src/note-store.test.ts covers all 5 cases.

# JSON Output Format

Produce a JSON object with exactly these fields:
- verdict: "accepted" | "rejected" | "inconclusive"
- classification: "transient" | "environment" | "input" | "permission" | "evaluation" | "strategy" | "unknown"
- summary: string
- goal_statuses: array of { goal_index: number, status: "passed"|"failed"|"inconclusive", evidence: string, reasoning: string }
- replan_guidance: null or { root_cause: string, what_failed: string, suggested_strategy: string, avoid_approaches: string[] }

# Instructions

Based on the investigation findings above, produce a structured JSON verdict for all 1 goal(s).`

// 用项目根目录加载配置（这样能读到 .opencorvus/opencorvus.jsonc）
const repoRoot = path.resolve(import.meta.dir, "../../../..")

await Instance.provide({
  directory: repoRoot,
  init: InstanceBootstrap,
  fn: async () => {
    const providers = await Provider.list()

    // 检查 hexin
    const hexin = providers["hexin"]
    if (hexin) {
      console.log(`✓ hexin provider: ${hexin.name}, models: [${Object.keys(hexin.models).join(", ")}]`)
    } else {
      console.log("✗ hexin provider NOT found")
      console.log("  available:", Object.keys(providers).join(", "))
      return
    }

    // 测试 hexin/gpt-5.4-mini
    for (const modelID of ["gpt-5.4-mini", "gpt-5.4"]) {
      if (!hexin.models[modelID]) { console.log(`  skip ${modelID}: not in models`); continue }
      console.log(`\n--- hexin/${modelID} ---`)
      try {
        const model = await Provider.getModel("hexin", modelID)
        const language = await Provider.getLanguage(model)
        const { object } = await generateObject({
          model: language,
          mode: "json",
          schema: EvaluatorAnalysis,
          maxRetries: 1,
          abortSignal: AbortSignal.timeout(60_000),
          system: JUDGMENT_SYSTEM,
          prompt: PROMPT,
        })
        console.log(`  ✓ verdict=${object.verdict}, goals=${object.goal_statuses.length}`)
      } catch (err: any) {
        console.log(`  ✗ ${err.message?.substring(0, 200)}`)
      }
    }

    // 也测 DashScope
    for (const pid of ["alibaba-coding-plan-cn"]) {
      const p = providers[pid]
      if (!p) continue
      const mid = Object.keys(p.models).find(m => m.includes("qwen")) || Object.keys(p.models)[0]
      if (!mid) continue
      console.log(`\n--- ${pid}/${mid} ---`)
      try {
        const model = await Provider.getModel(pid, mid)
        const language = await Provider.getLanguage(model)
        const { object } = await generateObject({
          model: language,
          mode: "json",
          schema: EvaluatorAnalysis,
          maxRetries: 1,
          abortSignal: AbortSignal.timeout(60_000),
          system: JUDGMENT_SYSTEM,
          prompt: PROMPT,
        })
        console.log(`  ✓ verdict=${object.verdict}, goals=${object.goal_statuses.length}`)
      } catch (err: any) {
        console.log(`  ✗ ${err.message?.substring(0, 200)}`)
      }
      break
    }
  },
})

console.log("\ndone")
