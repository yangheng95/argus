#!/usr/bin/env bun
/**
 * LEGACY benchmark prototype. Do not use as current webpage-clone policy:
 * active flows produce `web-clone-source/` evidence and require maintainable
 * project-owned React/Vue/etc. source plus Build/Integrity visual gates.
 *
 * Mirror tools → build-agent benchmark: clone https://www.bbc.com/.
 *
 * Acts as the "bbc-clone skill" prototype: the mirror tools are NOT
 * registered in `tool/registry.ts` (per isolated-integration design), so
 * this script plays the role the skill will play in Phase 2:
 *
 *   1. extract the reference page  (mirror/url/extract)
 *   2. analyze it                  (mirror/url/pattern::analyzePage)
 *   3. compile it to XML IR        (mirror/url/compile)
 *   4. pre-generate tokens + App   (mirror/url/pattern::generateTokensFile / generateAppFile)
 *   5. hand scaffold to build agent (SessionPrompt.prompt, model kimi-k2.5)
 *   6. render the output           (mirror/visual/render)
 *   7. score vs reference          (mirror/visual/evaluate)
 *   8. loop with diff feedback until score ≥ 85 or budget exhausted
 *
 * Model: `alibaba-coding-plan-cn/kimi-k2.5` (override via `BENCHMARK_MODEL` env).
 *
 * Usage:
 *   bun script/benchmark/mirror-bbc-clone.ts \
 *     [--output-dir=<path>] [--max-iterations=5] [--target-score=85] \
 *     [--reference-url=https://www.bbc.com/] [--viewport=1440x900]
 */

import fs from "node:fs/promises"
import { existsSync, mkdtempSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { loadBenchmarkEnv, ensureBenchmarkModel, env } from "./env"

import { extractPage } from "../../src/mirror/url/extract"
import { compilePageToXML } from "../../src/mirror/url/compile"
import { analyzePage, generateTokensFile, generateAppFile, buildSharedContext } from "../../src/mirror/url/pattern"
import { buildClonePrompt, buildCloneFeedback } from "../../src/mirror/url/prompt"
import { renderFiles } from "../../src/mirror/visual/render"
import { WEBPAGE_EVALUATE_PASS_SCORE, evaluateVisual } from "../../src/mirror/visual/evaluate"
import { compareText, extractTextFromTree } from "../../src/mirror/shared/content-compare"
import type { ExtractedPage, ExtractedElement } from "../../src/mirror/ir/extracted-page"
import type { ProjectScaffold } from "../../src/mirror/ir/scaffold"

import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Identifier } from "../../src/id/id"
import { Log } from "../../src/util/log"
import { Server } from "../../src/server/server"

Log.init({ print: true })

// ─── CLI flags ────────────────────────────────────────────────────────────

function flag(name: string, fallback?: string): string | undefined {
  const eq = process.argv.find((a) => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const idx = process.argv.indexOf(name)
  if (idx !== -1 && idx + 1 < process.argv.length) return process.argv[idx + 1]
  return fallback
}

const REFERENCE_URL = flag("--reference-url", "https://www.bbc.com/") ?? "https://www.bbc.com/"
const TARGET_SCORE = Number(flag("--target-score", String(WEBPAGE_EVALUATE_PASS_SCORE)))
const MAX_ITERATIONS = Number(flag("--max-iterations", "5"))
const ITERATION_TIMEOUT_MS = Number(flag("--iteration-timeout-ms", String(40 * 60 * 1000)))
const VIEWPORT = (() => {
  const raw = flag("--viewport", "1440x900") ?? "1440x900"
  const [w, h] = raw.split("x").map(Number)
  if (!Number.isFinite(w) || !Number.isFinite(h)) throw new Error(`bad --viewport: ${raw}`)
  return { width: w, height: h }
})()

const OUTPUT_DIR =
  flag("--output-dir") ??
  mkdtempSync(path.join(os.tmpdir(), `mirror-bbc-${Date.now()}-`))

const REPORT_FILE = path.join(OUTPUT_DIR, "benchmark-report.json")

// ─── Main ─────────────────────────────────────────────────────────────────

interface IterationReport {
  index: number
  startedAt: string
  durationMs: number
  filesGenerated: string[]
  score: number
  ssimScore: number
  pixelDiffPercent: number
  mismatchedPixels: number
  totalPixels: number
  renderError?: string
  agentError?: string
  promptChars: number
  feedbackChars: number
  screenshotPath?: string
  /** Tokens from the reference that are missing in the rendered output. */
  missingTokens?: string[]
  /** Score of the best iteration so far — when we regressed, we restored from `best-index.html`. */
  bestScoreBefore?: number
  rolledBackFromIndex?: boolean
}

interface Report {
  startedAt: string
  completedAt: string
  totalMs: number
  referenceUrl: string
  targetScore: number
  maxIterations: number
  model: string
  viewport: { width: number; height: number }
  outputDir: string
  accepted: boolean
  finalScore: number
  extractStats: ExtractedPage["stats"] & { title: string; byteSize: number }
  scaffoldSummary: {
    sectionCount: number
    sharedComponentCount: number
    patternCount: number
    patternCoverage: number
    tokenColors: number
    tokenFonts: number
    xmlIRBytes: number
    xmlIREstimatedTokens: number | undefined
  }
  iterations: IterationReport[]
  emergencyExit?: string
}

async function writeReport(r: Report) {
  await fs.writeFile(REPORT_FILE, JSON.stringify(r, null, 2))
}

process.on("uncaughtException", async (err) => {
  console.error(`[bbc-clone] uncaughtException: ${err.message}\n${err.stack ?? ""}`)
})

async function main() {
  const started = Date.now()
  const startedAt = new Date(started).toISOString()

  await loadBenchmarkEnv(import.meta.dir)

  // Provider init (invoked by ensureBenchmarkModel) reaches `Plugin.state`,
  // whose initializer reads `Server.url()`. If no server is listening, it
  // throws and provider init half-completes. Start a loopback server first.
  Server.listen({ port: 0, hostname: "127.0.0.1" })

  const modelStr = env("BENCHMARK_MODEL", "OPENCORVUS_BENCHMARK_MODEL") ?? "alibaba-coding-plan-cn/kimi-k2.5"

  const PACKAGE_ROOT = path.resolve(import.meta.dir, "../..")

  await fs.mkdir(OUTPUT_DIR, { recursive: true })
  console.log(`[bbc-clone] output dir: ${OUTPUT_DIR}`)
  console.log(`[bbc-clone] model:      ${modelStr}`)
  console.log(`[bbc-clone] reference:  ${REFERENCE_URL}`)
  console.log(`[bbc-clone] viewport:   ${VIEWPORT.width}x${VIEWPORT.height}`)
  console.log(`[bbc-clone] target:     ≥ ${TARGET_SCORE}%`)

  await ensureBenchmarkModel(import.meta.dir, modelStr)

  // ── 1. Extract the reference page ───────────────────────────────────────
  console.log(`[bbc-clone] step 1/4: extracting ${REFERENCE_URL}`)
  const page = await Instance.provide({
    directory: PACKAGE_ROOT,
    fn: () =>
      extractPage({
        url: REFERENCE_URL,
        viewport: VIEWPORT,
        waitMs: 3000,
        noScreenshots: false,
        outputDir: OUTPUT_DIR,
        onProgress: (msg) => console.log(`  [extract] ${msg}`),
      }),
  })

  // Save the reference screenshot to disk — needed for every evaluate call.
  const referencePath = path.join(OUTPUT_DIR, "reference.png")
  const refBase64 = page.screenshotUrl.replace(/^data:image\/png;base64,/, "")
  await fs.writeFile(referencePath, Buffer.from(refBase64, "base64"))
  console.log(`  reference screenshot: ${referencePath} (${(Buffer.byteLength(refBase64, "base64") / 1024).toFixed(0)}KB)`)

  // ── 2. Analyze (tokens + patterns + scaffold) ───────────────────────────
  console.log(`[bbc-clone] step 2/4: analysing page (tokens + patterns + scaffold)`)
  const scaffold: ProjectScaffold = analyzePage(page)

  // ── 3. Compile page + write pre-generated files ─────────────────────────
  console.log(`[bbc-clone] step 3/4: compiling XML IR + pre-generated files`)
  const xmlIR = compilePageToXML({ page })

  const tokensFile = generateTokensFile(scaffold)
  const appFile = generateAppFile(scaffold)
  const sharedContext = buildSharedContext(scaffold, {
    url: page.url,
    title: page.title,
    viewport: page.viewport,
  })

  // Pre-generated token + App files land in the worktree so the agent doesn't
  // re-implement them.
  const tokensDst = path.join(OUTPUT_DIR, "design-tokens.ts")
  const appDst = path.join(OUTPUT_DIR, "App.tsx")
  await fs.writeFile(tokensDst, tokensFile.code, "utf8")
  await fs.writeFile(appDst, appFile.code, "utf8")

  // Drop the XML IR + shared context alongside the code so the agent can read
  // them as files (the prompt also carries copies for in-context reference).
  await fs.writeFile(path.join(OUTPUT_DIR, "page-ir.xml"), xmlIR.xml, "utf8")
  await fs.writeFile(path.join(OUTPUT_DIR, "shared-context.md"), sharedContext, "utf8")
  await fs.writeFile(path.join(OUTPUT_DIR, "scaffold.json"), JSON.stringify(scaffold, null, 2), "utf8")

  const scaffoldSummary = {
    sectionCount: scaffold.sections.length,
    sharedComponentCount: scaffold.sharedComponents.length,
    patternCount: scaffold.catalog.patterns.length,
    patternCoverage:
      scaffold.catalog.totalElements > 0
        ? Math.round((scaffold.catalog.coveredElements / scaffold.catalog.totalElements) * 100)
        : 0,
    tokenColors: scaffold.tokens.colors.length,
    tokenFonts: scaffold.tokens.fonts.length,
    xmlIRBytes: xmlIR.bytes,
    xmlIREstimatedTokens: xmlIR.estimatedTokens,
  }
  console.log(`  ${scaffold.sections.length} sections, ${scaffold.catalog.patterns.length} patterns, `
    + `XML IR ${Math.round(xmlIR.bytes / 1024)}KB (~${xmlIR.estimatedTokens} tokens)`)

  // ── 4. Build-agent loop ────────────────────────────────────────────────
  console.log(`[bbc-clone] step 4/4: build-agent loop (max ${MAX_ITERATIONS} iterations)`)

  const report: Report = {
    startedAt,
    completedAt: "",
    totalMs: 0,
    referenceUrl: REFERENCE_URL,
    targetScore: TARGET_SCORE,
    maxIterations: MAX_ITERATIONS,
    model: modelStr,
    viewport: VIEWPORT,
    outputDir: OUTPUT_DIR,
    accepted: false,
    finalScore: 0,
    extractStats: {
      ...page.stats,
      title: page.title,
      byteSize: xmlIR.bytes,
    },
    scaffoldSummary,
    iterations: [],
  }
  await writeReport(report)

  // Reference text catalog — what the rendered clone must reproduce.
  const referenceText = extractTextFromTree(page.tree as unknown as Parameters<typeof extractTextFromTree>[0])
  console.log(`  reference text catalog: ${referenceText.length} chars`)

  // Run the session loop inside an Instance provided at the worktree so tool
  // calls (write/edit/read) resolve relative paths to OUTPUT_DIR.
  await Instance.provide({
    directory: OUTPUT_DIR,
    fn: async () => {
      const parsed = Provider.parseModel(modelStr)

      const session = await Session.createNext({
        kind: "build",
        title: `BBC clone benchmark — ${new Date().toISOString()}`,
        directory: OUTPUT_DIR,
      })
      console.log(`  session: ${session.id}`)

      let lastFeedback: string | undefined
      let bestScore = -1
      let consecutiveNoImprovement = 0
      const bestIndexPath = path.join(OUTPUT_DIR, "best-index.html")

      for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
        const iterStart = Date.now()
        const record: IterationReport = {
          index: iter,
          startedAt: new Date(iterStart).toISOString(),
          durationMs: 0,
          filesGenerated: [],
          score: 0,
          ssimScore: 0,
          pixelDiffPercent: 100,
          mismatchedPixels: 0,
          totalPixels: 0,
          promptChars: 0,
          feedbackChars: lastFeedback?.length ?? 0,
        }

        console.log(`\n[bbc-clone] iteration ${iter}/${MAX_ITERATIONS}`)
        record.bestScoreBefore = bestScore

        // If we know a best state and the last iteration regressed below it,
        // restore the best-known index.html before prompting the agent again.
        // This keeps the agent anchored to its best work rather than compounding
        // losses iteration over iteration.
        if (iter > 1 && bestScore > 0 && existsSync(bestIndexPath)) {
          const liveIndex = path.join(OUTPUT_DIR, "index.html")
          const prevIter = report.iterations[report.iterations.length - 1]
          if (prevIter && prevIter.score < bestScore) {
            await fs.copyFile(bestIndexPath, liveIndex)
            record.rolledBackFromIndex = true
            console.log(
              `  regression detected — restored index.html from iter with score ${bestScore} ` +
                `(last iter scored ${prevIter.score})`,
            )
          }
        }

        const promptText = buildClonePrompt({
          iter,
          referenceUrl: REFERENCE_URL,
          targetScore: TARGET_SCORE,
          viewport: VIEWPORT,
          outputDir: OUTPUT_DIR,
          sharedContext,
          xmlIRBytes: xmlIR.bytes,
          scaffold,
          previousFeedback: lastFeedback,
        })
        record.promptChars = promptText.length

        try {
          await withTimeout(
            SessionPrompt.prompt({
              sessionID: session.id,
              messageID: Identifier.ascending("message"),
              model: { providerID: parsed.providerID, modelID: parsed.modelID },
              agent: "build",
              parts: [{ type: "text", text: promptText }],
              tools: {
                // Enable everything the build agent needs to write a static clone.
                write: true,
                edit: true,
                read: true,
                ls: true,
                glob: true,
                grep: true,
                bash: true,
                // Disable task dispatch — skill-level, not agent-level, in this benchmark.
                task: false,
              },
            }),
            ITERATION_TIMEOUT_MS,
            `iteration ${iter} agent step`,
          )
        } catch (err) {
          record.agentError = err instanceof Error ? err.message : String(err)
          console.error(`  agent error: ${record.agentError}`)
        }

        // List files the agent created so we know whether index.html exists.
        record.filesGenerated = await listWorktreeFiles(OUTPUT_DIR)
        const indexPath = path.join(OUTPUT_DIR, "index.html")
        if (!existsSync(indexPath)) {
          record.renderError = "index.html missing — skipping render/evaluate"
          record.durationMs = Date.now() - iterStart
          report.iterations.push(record)
          await writeReport(report)
          lastFeedback = `Iteration ${iter} did not produce index.html. Create it at the output root as a single-file vanilla-CSS document — one <style> block under <head>, design tokens injected as :root custom properties, no Tailwind, no JS framework.`
          continue
        }

        // ── render ──────────────────────────────────────────────────────
        let screenshotDataUrl = ""
        try {
          const render = await renderFiles({
            outputDir: OUTPUT_DIR,
            viewport: VIEWPORT,
            fullPage: false,
          })
          screenshotDataUrl = render.screenshotDataUrl
          const pathRendered = path.join(OUTPUT_DIR, `rendered-${iter}.png`)
          await fs.writeFile(pathRendered, render.screenshotBuffer)
          record.screenshotPath = pathRendered
        } catch (err) {
          record.renderError = err instanceof Error ? err.message : String(err)
          record.durationMs = Date.now() - iterStart
          report.iterations.push(record)
          await writeReport(report)
          lastFeedback = `Render failed: ${record.renderError}. Check index.html for syntax errors and make sure every script tag loads cleanly.`
          continue
        }

        // ── evaluate ────────────────────────────────────────────────────
        const evalReport = await evaluateVisual({
          originalImage: referencePath,
          renderedImage: screenshotDataUrl,
        })
        record.score = evalReport.overallScore
        record.ssimScore = evalReport.ssimScore
        record.pixelDiffPercent = evalReport.pixelDiffPercent
        record.mismatchedPixels = evalReport.mismatchedPixels
        record.totalPixels = evalReport.totalPixels

        // ── text-diff feedback (re-extract the rendered index.html) ─────
        // Uses puppeteer-core again. Cheap (~5s) and gives the agent
        // concrete missing phrases to plug rather than generic guidance.
        let missingTokens: string[] = []
        try {
          const indexFileUrl = pathToFileUrl(path.join(OUTPUT_DIR, "index.html"))
          const rendered = await extractPage({
            url: indexFileUrl,
            viewport: VIEWPORT,
            waitMs: 3000,
            noScreenshots: true,
          })
          const renderedText = extractTextFromTree(rendered.tree as unknown as Parameters<typeof extractTextFromTree>[0])
          // If extraction returned empty (e.g. agent wrote JS-hydrated HTML and
          // hydration didn't complete), skip text-diff feedback entirely — feeding
          // bogus "missing tokens" would mislead the next iteration. The prompt
          // already requires static HTML, so empty extraction means the agent
          // violated the rule; surface it clearly.
          if (renderedText.length === 0) {
            console.warn(
              `  text-diff skipped: rendered page produced no visible text (agent likely used JS hydration — violates static-HTML rule)`,
            )
          } else {
            const textCompare = compareText(referenceText, renderedText)
            missingTokens = textCompare.missingTokens
            record.missingTokens = missingTokens
            console.log(
              `  text coverage: ${textCompare.coverageRate.toFixed(3)}  `
                + `missing: ${missingTokens.length} tokens  jaccard: ${textCompare.jaccardSimilarity.toFixed(3)}  `
                + `(ref=${referenceText.length}ch, rendered=${renderedText.length}ch)`,
            )
          }
        } catch (err) {
          console.warn(
            `  text-diff failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
          )
        }

        record.durationMs = Date.now() - iterStart

        // Best-state preservation + stagnation tracking: snapshot index.html
        // whenever we hit a new high; otherwise tick the no-improvement counter.
        if (record.score > bestScore) {
          bestScore = record.score
          consecutiveNoImprovement = 0
          const liveIndex = path.join(OUTPUT_DIR, "index.html")
          if (existsSync(liveIndex)) {
            await fs.copyFile(liveIndex, bestIndexPath)
          }
        } else {
          consecutiveNoImprovement += 1
        }

        report.iterations.push(record)
        await writeReport(report)

        console.log(
          `  score: ${record.score}/100  (ssim=${record.ssimScore.toFixed(3)}  `
            + `pixelDiff=${record.pixelDiffPercent.toFixed(2)}%)  files=${record.filesGenerated.length}  `
            + `${record.durationMs}ms${record.rolledBackFromIndex ? "  [rolled-back-before]" : ""}`,
        )

        if (record.score >= TARGET_SCORE) {
          report.accepted = true
          report.finalScore = record.score
          console.log(`\n[bbc-clone] ✅ accepted at iteration ${iter} (score ${record.score} ≥ ${TARGET_SCORE})`)
          break
        }

        report.finalScore = Math.max(report.finalScore, record.score)

        if (consecutiveNoImprovement >= 3) {
          console.log(
            `\n[bbc-clone] ⏹  stagnation: ${consecutiveNoImprovement} consecutive iterations without a new high score (best=${bestScore}/100). Stopping iteration; handing off best snapshot.`,
          )
          report.finalScore = bestScore
          break
        }

        // Build feedback for the next iteration.
        lastFeedback = buildCloneFeedback({
          iter,
          evalReport,
          referencePath,
          targetScore: TARGET_SCORE,
          bestScore,
          consecutiveNoImprovement,
          missingTokens,
        })
      }
    },
  })

  report.completedAt = new Date().toISOString()
  report.totalMs = Date.now() - started
  await writeReport(report)

  console.log(
    `\n[bbc-clone] done: accepted=${report.accepted} finalScore=${report.finalScore} iterations=${report.iterations.length} duration=${(report.totalMs / 1000).toFixed(1)}s`,
  )
  console.log(`[bbc-clone] report: ${REPORT_FILE}`)

  process.exit(report.accepted ? 0 : 1)
}

// Prompt + feedback builders live in src/mirror/url/prompt.ts (single source
// shared with the webpage-generate skill — rule 22).

/** Convert an OS path to a `file:///` URL usable by puppeteer. */
function pathToFileUrl(p: string): string {
  const abs = path.resolve(p).replace(/\\/g, "/")
  // Windows: path.resolve returns "D:/..." (or "C:/..."); file URL needs
  // "file:///D:/..." prefix. On POSIX: "/abs/path" → "file:///abs/path".
  return abs.startsWith("/") ? `file://${abs}` : `file:///${abs}`
}

// ─── Utilities ────────────────────────────────────────────────────────────

async function listWorktreeFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  async function walk(d: string, rel: string) {
    for (const name of await fs.readdir(d)) {
      if (name.startsWith(".")) continue
      if (name === "node_modules") continue
      const full = path.join(d, name)
      const stat = await fs.stat(full)
      if (stat.isDirectory()) {
        await walk(full, path.posix.join(rel, name))
      } else {
        out.push(path.posix.join(rel, name))
      }
    }
  }
  await walk(dir, "")
  return out.sort()
}

function withTimeout<T>(promise: Promise<T>, ms: number, tag: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${tag} timed out after ${Math.round(ms / 1000)}s`)), ms)
  })
  return Promise.race([promise.finally(() => clearTimeout(timer!)), timeout])
}

main().catch(async (err) => {
  console.error(`[bbc-clone] fatal: ${err instanceof Error ? err.message : String(err)}`)
  if (err instanceof Error && err.stack) console.error(err.stack)
  try {
    const partial: Partial<Report> & { emergencyExit: string } = {
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      referenceUrl: REFERENCE_URL,
      targetScore: TARGET_SCORE,
      maxIterations: MAX_ITERATIONS,
      outputDir: OUTPUT_DIR,
      accepted: false,
      finalScore: 0,
      iterations: [],
      emergencyExit: err instanceof Error ? err.message : String(err),
    }
    writeFileSync(REPORT_FILE, JSON.stringify(partial, null, 2))
  } catch {}
  process.exit(2)
})
