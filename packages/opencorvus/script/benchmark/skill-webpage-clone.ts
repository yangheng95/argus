#!/usr/bin/env bun
/**
 * Skill-driven webpage-clone e2e benchmark.
 *
 * The previous benchmark (`mirror-baidu-clone.ts`) acted as the skill itself,
 * calling each mirror algorithm from TypeScript. This one invokes the agent
 * with the *real* `webpage-clone` skill registered in
 * `src/skill/builtin/webpage-clone.md`, exercising the production end-to-end
 * path an actual user would hit:
 *
 *     user prompt → skill activation → webpage_extract → webpage_compile
 *     → webpage_analyze → agent writes index.html → webpage_render
 *     → webpage_evaluate → iterate until score ≥ target
 *
 * No mirror functions are called directly from this script except for the
 * final rescore (which is only used to cross-check the agent's reported
 * score). All artifacts go through the tool shells.
 *
 * Usage:
 *   bun script/benchmark/skill-webpage-clone.ts \
 *     [--url=<url>] [--target-score=95] [--agent-timeout-ms=1800000] \
 *     [--output-dir=<path>]
 *
 * When `--url` is omitted the agent is prompted without one, so the skill's
 * "resolve URL via websearch" branch gets exercised.
 */

import fs from "node:fs/promises"
import { mkdtempSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { loadBenchmarkEnv, ensureBenchmarkModel, env } from "./env"
import { evaluateVisual } from "../../src/mirror/visual/evaluate"
import { extractPage } from "../../src/mirror/url/extract"
import { renderFiles } from "../../src/mirror/visual/render"

import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Identifier } from "../../src/id/id"
import { Log } from "../../src/util/log"
import { Server } from "../../src/server/server"

Log.init({ print: true })

function flag(name: string, fallback?: string): string | undefined {
  const eq = process.argv.find((a) => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const idx = process.argv.indexOf(name)
  if (idx !== -1 && idx + 1 < process.argv.length) return process.argv[idx + 1]
  return fallback
}

const URL = flag("--url") // may be undefined — skill should websearch
const SUBJECT = flag("--subject", "Baidu") ?? "Baidu"
const TARGET_SCORE = Number(flag("--target-score", "95"))
const AGENT_TIMEOUT_MS = Number(flag("--agent-timeout-ms", String(60 * 60 * 1000)))
const OUTPUT_DIR =
  flag("--output-dir") ??
  mkdtempSync(path.join(os.tmpdir(), `skill-webpage-clone-${Date.now()}-`))

interface Report {
  startedAt: string
  completedAt: string
  totalMs: number
  subject: string
  suppliedUrl: string | undefined
  targetScore: number
  model: string
  outputDir: string
  agentError?: string
  agentResponse?: string
  indexHtmlExists: boolean
  indexHtmlBytes?: number
  rescore?: {
    overallScore: number
    ssimScore: number
    pixelDiffPercent: number
  }
  accepted: boolean
}

async function main() {
  const started = Date.now()
  await loadBenchmarkEnv(import.meta.dir)
  Server.listen({ port: 0, hostname: "127.0.0.1" })

  const modelStr = env("BENCHMARK_MODEL", "OPENCORVUS_BENCHMARK_MODEL") ?? "alibaba-coding-plan-cn/kimi-k2.5"

  await fs.mkdir(OUTPUT_DIR, { recursive: true })
  console.log(`[skill-clone] output dir: ${OUTPUT_DIR}`)
  console.log(`[skill-clone] model:      ${modelStr}`)
  console.log(`[skill-clone] subject:    ${URL ?? SUBJECT}${URL ? "" : " (no URL — skill must websearch)"}`)
  console.log(`[skill-clone] target:     ≥ ${TARGET_SCORE}%`)

  await ensureBenchmarkModel(import.meta.dir, modelStr)

  const report: Report = {
    startedAt: new Date(started).toISOString(),
    completedAt: "",
    totalMs: 0,
    subject: SUBJECT,
    suppliedUrl: URL,
    targetScore: TARGET_SCORE,
    model: modelStr,
    outputDir: OUTPUT_DIR,
    indexHtmlExists: false,
    accepted: false,
  }
  const reportFile = path.join(OUTPUT_DIR, "skill-benchmark-report.json")
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2))

  const userPrompt = URL
    ? `Clone this webpage as a static HTML skeleton with visual similarity ≥ ${TARGET_SCORE}%: ${URL}\n\nUse the webpage-clone skill. Write the final \`index.html\` in the current working directory.`
    : `Clone ${SUBJECT}'s homepage as a static HTML skeleton with visual similarity ≥ ${TARGET_SCORE}%.\n\nUse the webpage-clone skill — since I did not provide a URL, the skill should websearch the canonical URL first. Write the final \`index.html\` in the current working directory.`

  let agentResponse = ""
  try {
    await Instance.provide({
      directory: OUTPUT_DIR,
      fn: async () => {
        const parsed = Provider.parseModel(modelStr)
        const session = await Session.createNext({
          kind: "build",
          title: `Skill webpage clone — ${SUBJECT}`,
          directory: OUTPUT_DIR,
        })
        console.log(`[skill-clone] session: ${session.id}`)

        const result = await withTimeout(
          SessionPrompt.prompt({
            sessionID: session.id,
            messageID: Identifier.ascending("message"),
            model: { providerID: parsed.providerID, modelID: parsed.modelID },
            agent: "build",
            parts: [{ type: "text", text: userPrompt }],
            tools: {
              // Full toolbox. The skill decides which tools to use.
              write: true,
              edit: true,
              read: true,
              ls: true,
              glob: true,
              grep: true,
              bash: true,
              websearch: true, // agent must be able to resolve URL when missing
              webfetch: true,
              skill: true,
              // Mirror tools
              webpage_extract: true,
              webpage_compile: true,
              webpage_analyze: true,
              webpage_render: true,
              webpage_evaluate: true,
              webpage_text_diff: true,
              task: false,
            },
          }),
          AGENT_TIMEOUT_MS,
          "agent run",
        )

        const lastText = result.parts.findLast((p) => p.type === "text")
        agentResponse = lastText?.text ?? ""
      },
    })
  } catch (err) {
    report.agentError = err instanceof Error ? err.message : String(err)
    console.error(`[skill-clone] agent error: ${report.agentError}`)
  }

  report.agentResponse = agentResponse.slice(0, 2000)

  // Post-hoc verification: did the agent produce index.html at all?
  const indexPath = path.join(OUTPUT_DIR, "index.html")
  try {
    const stat = await fs.stat(indexPath)
    report.indexHtmlExists = true
    report.indexHtmlBytes = stat.size
  } catch {}

  // Self-contained rescore: re-extract the reference URL, re-render the
  // surviving index.html, and compare. Works regardless of whether the
  // skill cleaned up its intermediate artifacts (which it should have on
  // success, per webpage-clone skill step 8).
  if (report.indexHtmlExists && URL) {
    try {
      const rescoreRefDir = mkdtempSync(path.join(os.tmpdir(), `rescore-ref-${Date.now()}-`))
      await Instance.provide({
        directory: OUTPUT_DIR,
        fn: async () => {
          const page = await extractPage({
            url: URL,
            viewport: { width: 1440, height: 900 },
            waitMs: 3000,
            noScreenshots: false,
            outputDir: rescoreRefDir,
          })
          const refPath = path.join(rescoreRefDir, "reference.png")
          await fs.writeFile(
            refPath,
            Buffer.from(page.screenshotUrl.replace(/^data:image\/png;base64,/, ""), "base64"),
          )
          const render = await renderFiles({
            outputDir: OUTPUT_DIR,
            viewport: { width: 1440, height: 900 },
          })
          const r = await evaluateVisual({
            originalImage: refPath,
            renderedImage: render.screenshotDataUrl,
          })
          report.rescore = {
            overallScore: r.overallScore,
            ssimScore: r.ssimScore,
            pixelDiffPercent: r.pixelDiffPercent,
          }
          report.accepted = r.overallScore >= TARGET_SCORE
          console.log(
            `[skill-clone] rescore (fresh extract+render): ${r.overallScore}/100  ssim=${r.ssimScore.toFixed(3)}  pixelDiff=${r.pixelDiffPercent.toFixed(2)}%  accepted=${report.accepted}`,
          )
        },
      })
    } catch (err) {
      console.warn(`[skill-clone] rescore failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  report.completedAt = new Date().toISOString()
  report.totalMs = Date.now() - started
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2))

  console.log(
    `[skill-clone] done: accepted=${report.accepted} agent_error=${report.agentError ? "yes" : "no"} duration=${(report.totalMs / 1000).toFixed(1)}s`,
  )
  console.log(`[skill-clone] report: ${reportFile}`)

  process.exit(report.accepted ? 0 : 1)
}

function withTimeout<T>(promise: Promise<T>, ms: number, tag: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${tag} timed out after ${Math.round(ms / 1000)}s`)), ms)
  })
  return Promise.race([promise.finally(() => clearTimeout(timer!)), timeout])
}

main().catch((err) => {
  console.error(`[skill-clone] fatal: ${err instanceof Error ? err.message : String(err)}`)
  if (err instanceof Error && err.stack) console.error(err.stack)
  process.exit(2)
})
