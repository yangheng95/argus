#!/usr/bin/env bun
/**
 * Evaluates PlannerService spec analysis quality.
 * Compares template-only output vs LLM-enhanced output.
 *
 * Usage: bun run script/planner-spec-eval.ts
 */
import { PlannerService } from "../src/planner/service"
import { Instance } from "../src/project/instance"
import { tmpdir } from "../test/fixture/fixture"

const SPECS = [
  {
    label: "VAGUE",
    title: "优化性能",
    request: "优化性能",
  },
  {
    label: "MEDIUM",
    title: "修复session列表加载慢",
    request:
      "session列表页面在超过100个session时加载需要3秒以上。优化查询并添加分页。",
  },
  {
    label: "DETAILED",
    title: "Add dark mode toggle to overlay",
    request: `Add a dark/light mode toggle to the overlay panel.

Requirements:
- Toggle button in the titlebar next to the pin button
- Persist selection in localStorage
- Dark mode is the default
- Light mode: white background, dark text
- Transition: 200ms ease
- CSS custom properties for all theme colors

Files: overlay/src/index.html, overlay/src/styles.css, overlay/src/app.js`,
  },
]

async function main() {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      for (const spec of SPECS) {
        console.log(`\n${"=".repeat(70)}`)
        console.log(`SPEC: ${spec.label} — "${spec.title}"`)
        console.log(`${"=".repeat(70)}`)

        // Template-only (LLM disabled)
        process.env.OPENCORVUS_PLANNER_LLM = "0"
        const templatePlan = await PlannerService.initial({
          title: spec.title,
          request: spec.request,
        })

        console.log("\n--- TEMPLATE OUTPUT ---")
        console.log(`Summary: ${templatePlan.summary}`)
        console.log(`Goals (${templatePlan.goals.length}):`)
        for (const g of templatePlan.goals) {
          console.log(`  [${g.priority}] ${g.description}`)
          console.log(`   Criteria: ${g.criteria}`)
        }
        console.log(`Prompt: ${templatePlan.prompt.length} chars`)

        // LLM-enhanced
        delete process.env.OPENCORVUS_PLANNER_LLM
        try {
          const llmPlan = await PlannerService.initial({
            title: spec.title,
            request: spec.request,
          })

          const metadata = llmPlan.metadata as Record<string, unknown>
          console.log("\n--- LLM OUTPUT ---")
          console.log(`Summary: ${llmPlan.summary}`)
          if (metadata.risks && Array.isArray(metadata.risks)) {
            console.log(`\nRisks (${metadata.risks.length}):`)
            for (const r of metadata.risks) console.log(`  - ${r}`)
          }
          console.log(`\nGoals (${llmPlan.goals.length}):`)
          for (const g of llmPlan.goals) {
            console.log(`  [${g.priority}] ${g.description}`)
            console.log(`   Criteria: ${g.criteria}`)
          }
          console.log(`Prompt: ${llmPlan.prompt.length} chars`)

          // Quality comparison
          console.log("\n--- COMPARISON ---")
          console.log(`Template goals: ${templatePlan.goals.length} | LLM goals: ${llmPlan.goals.length}`)
          console.log(`Template prompt: ${templatePlan.prompt.length} chars | LLM prompt: ${llmPlan.prompt.length} chars`)
          if (metadata.risks && Array.isArray(metadata.risks)) {
            console.log(`Risk areas identified: ${metadata.risks.length}`)
          }
        } catch (error) {
          console.log("\n--- LLM FAILED ---")
          console.log(`Error: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      console.log("\n" + "=".repeat(70))
      console.log("EVALUATION COMPLETE")
      console.log("=".repeat(70))
      process.exit(0)
    },
  })
}

main().catch((error) => {
  console.error("Fatal:", error)
  process.exit(1)
})
