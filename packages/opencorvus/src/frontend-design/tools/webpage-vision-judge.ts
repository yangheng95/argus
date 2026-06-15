/**
 * `webpage_vision_judge` tool — single-shot vision LLM call comparing two
 * screenshots (reference vs rendered) and emitting a structured diff list.
 *
 * Replaces the SSIM-number / pixel-diff / text-diff trio that the build
 * agent was using as proxy signals. Those proxies tempted the model into
 * grep-and-edit text iteration without ever attending to the rendered
 * pixels — score plateaued well below target because the visual gaps
 * (logo SVG paw print, icon precision) were invisible to a text-only
 * feedback loop. This tool forces a second LLM call where the ONLY
 * input is the two PNGs + a tiny prompt; no system tail, no tool list,
 * no SSIM number to anchor on. The agent then has to act on actual
 * visual differences before the next edit pass.
 *
 * Output: `webpage-evidence/vision-judge.json` — structured verdict (pass/fail
 * + ranked differences). Consumers should treat this file's `accepted` field
 * as structured visual review evidence. Tool failure produces no verdict file;
 * callers must retry or fix the root cause.
 *
 * Pure tool: no network beyond the LLM call, deterministic per (model,
 * reference, rendered) triple.
 */

import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"

import { Output } from "ai"

import { Tool } from "../../tool/tool"
import { Provider } from "../../provider/provider"
import { ProviderLLM } from "../../provider/llm"
import { ProviderSchema } from "../../provider/schema"
import { resolveConfiguredModelRef } from "../../agent/model"
import { EffectiveConfig } from "../../config/effective"
import { Log } from "../../util/log"
import {
  withLLMActivity,
  chunkHeartbeatKind,
  DefaultLLMActivityPolicy,
  LLMActivityError,
  type LLMActivityPolicy,
} from "../../llm/activity"
import { streamText } from "../../llm/api"
import { resolveWebpageEvidenceOutputDir, DEFAULT_WEBPAGE_EVIDENCE_SUBDIR } from "./output-dir"
import { tryMaterializeVisualEvidenceBundle } from "./visual-evidence-bundle"

// Idle window before we abort a hung vision-judge stream. Mirrors the
// session.processor 180s gate (util/stream-activity.ts callers); kept in
// sync via the same heuristic — provider stalls past 3 minutes are stuck,
// not slow. Without this gate, a hung alibaba-coding-plan-cn (kimi-k2.5)
// upstream call wedges the entire build session: the SDK stream reader parks on a
// reader.read() promise that AbortController alone does not unblock, and
// the parent agent's stream-idle gate has been pause()d while this tool
// runs (session.processor's pause-around-tool semantics — see
// stream-activity.ts pause/resume comment).
const VISION_JUDGE_IDLE_MS = 180_000

const log = Log.create({ service: "webpage-evidence.tool.webpage_vision_judge" })

function normalizeSeverity(value: unknown): unknown {
  if (typeof value !== "string") return value
  const normalized = value.trim().toLowerCase()
  if (normalized === "critical") return "critical"
  if (normalized === "major" || normalized === "high" || normalized === "medium") return "major"
  if (normalized === "minor" || normalized === "low") return "minor"
  return value
}

function normalizeDifferenceShape(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value
  const record = { ...(value as Record<string, unknown>) }
  record.severity = normalizeSeverity(record.severity)
  record.observed ??= record.see ?? record.what_you_see ?? record.whatYouSee
  record.expected ??= record.should_see ?? record.shouldSee ?? record.what_you_should_see ?? record.whatYouShouldSee
  record.fix_hint ??= record.fix ?? record.fixHint
  return record
}

function normalizeVerdictShape(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value
  const record = { ...(value as Record<string, unknown>) }
  if (Array.isArray(record.differences)) {
    record.differences = record.differences.map(normalizeDifferenceShape)
  }
  if (typeof record.overall_impression !== "string" || !record.overall_impression.trim()) {
    const differences = Array.isArray(record.differences) ? record.differences : []
    record.overall_impression =
      record.accepted === true && differences.length === 0
        ? "Rendered screenshot appears visually faithful to the reference."
        : `Rendered screenshot has ${differences.length} visible difference(s) that require review.`
  }
  return record
}

const VerdictSchema = z.preprocess(
  normalizeVerdictShape,
  z.object({
    accepted: z
      .boolean()
      .describe(
        "true ONLY when the rendered screenshot is visually faithful to the reference: " +
          "all top-level sections present, palette matches, key UI elements (logos, " +
          "buttons, search boxes, icons) are visually correct. Set false if ANY " +
          "high-impact element is missing, distorted, or in the wrong colour.",
      ),
    overall_impression: z
      .string()
      .describe("One-sentence summary of how the rendered output compares to the reference."),
    differences: z
      .array(
        z.preprocess(
          normalizeDifferenceShape,
          z.object({
            severity: z
              .enum(["critical", "major", "minor"])
              .describe(
                "critical = section/structure missing or broken. major = wrong colours, " +
                  "wrong icon shape, wrong text, mis-positioned hero element. minor = " +
                  "small spacing / font-weight / shade variations.",
              ),
            region: z
              .string()
              .describe(
                "Where in the page the difference is (e.g. 'top nav', 'logo', 'search box', " +
                  "'hot-search list row 1', 'footer right corner').",
              ),
            observed: z.string().describe("What you ACTUALLY see in the rendered screenshot at that region."),
            expected: z.string().describe("What you SHOULD see based on the reference screenshot."),
            fix_hint: z
              .string()
              .describe(
                "One concrete edit suggestion the developer should make next " +
                  "(e.g. 'replace shape-blob div with inline SVG paw-print path', " +
                  "'change second mic icon to paperclip', 'shrink hot-search row " +
                  "vertical padding to match reference').",
              ),
          }),
        ),
      )
      .describe(
        "Ranked list of visual differences, most severe first. " + "Empty array allowed only when accepted=true.",
      ),
  }),
)

export function normalizeVisionJudgeVerdictForTest(value: unknown): z.infer<typeof VerdictSchema> {
  return VerdictSchema.parse(value)
}

export const WebpageVisionJudgeTool = Tool.define("webpage_vision_judge", {
  description: `Vision-only side-by-side comparison of a reference screenshot and a rendered screenshot. Calls a vision-capable LLM with NO system prompt, NO tool list, NO scores — just the two images and a request to enumerate visible differences.

Use this AFTER \`webpage_render\` and \`webpage_evaluate\` produce fresh artifacts. The verdict goes to \`webpage-evidence/vision-judge.json\` and is qualitative visual review evidence; \`webpage_evaluate\` owns the 85/100 numeric visual threshold.

Loop semantics: when \`accepted=false\`, work through the \`differences\` list (severity-ordered), re-render, and re-run this tool. When \`accepted=true\`, the visual acceptance gate is satisfied.

Pure transformation, no network besides the LLM call. Deterministic per (model, reference, rendered) triple.`,
  parameters: z.object({
    reference: z
      .string()
      .describe("Path to the reference PNG (defaults to `reference.png` inside the webpage evidence dir).")
      .optional(),
    rendered: z
      .string()
      .describe("Path to the rendered PNG (defaults to `rendered.png` inside the webpage evidence dir).")
      .optional(),
    outputDir: z
      .string()
      .describe(
        `Directory used to resolve relative paths and to write \`vision-judge.json\`. ` +
          `Defaults to task-scoped \`${DEFAULT_WEBPAGE_EVIDENCE_SUBDIR}\`. Do not set this during task sessions; overrides are for benchmarks/tests and task-session overrides must stay under \`${DEFAULT_WEBPAGE_EVIDENCE_SUBDIR}\`.`,
      )
      .optional(),
  }),
  async execute(params, ctx) {
    const outputDir = await resolveWebpageEvidenceOutputDir({ override: params.outputDir, sessionID: ctx.sessionID })
    const resolve = (p: string) => (path.isAbsolute(p) ? p : path.resolve(outputDir, p))
    const referencePath = resolve(params.reference ?? "reference.png")
    const renderedPath = resolve(params.rendered ?? "rendered.png")

    const [referenceBytes, renderedBytes] = await Promise.all([fs.readFile(referencePath), fs.readFile(renderedPath)])

    // Single configured-model resolver (spec §13.2): session overlay > base.
    const config = await EffectiveConfig.effective({ sessionID: ctx.sessionID })
    const parsed = await resolveConfiguredModelRef({ sessionID: ctx.sessionID })
    const model = await Provider.getModel(parsed.providerID, parsed.modelID, { config })
    const language = ProviderLLM.wrapModel(await Provider.getLanguage(model, { config }), model, {})

    if (!model.capabilities.input.image) {
      throw new Error(
        `webpage_vision_judge requires a vision-capable model. ` +
          `Configured model ${parsed.providerID}/${parsed.modelID} has capabilities.input.image=false. ` +
          `Switch to a vision-capable model (e.g. alibaba-coding-plan-cn/kimi-k2.5, claude-sonnet-4) ` +
          `via Config.model or pass an explicit override.`,
      )
    }

    const userPrompt =
      "You are comparing two screenshots of a webpage:\n" +
      "  1. Reference (the target — what the page should look like)\n" +
      "  2. Rendered (the current attempt — what the running app produces)\n\n" +
      "List every visible difference. For each: severity, region, what you see, what you should see, " +
      "and one concrete fix the developer should make. Then decide accepted=true ONLY when all " +
      "high-impact elements are visually faithful (sections present, palette right, key icons / " +
      "logos / buttons correct in shape and colour). Look at the pixels — do not rely on any " +
      "external metric. Be specific: name the region, the colour, the element."

    log.info("calling vision judge", {
      providerID: parsed.providerID,
      modelID: parsed.modelID,
      referencePath,
      renderedPath,
      referenceBytes: referenceBytes.length,
      renderedBytes: renderedBytes.length,
    })

    const judgePath = path.join(outputDir, "vision-judge.json")

    // 1-element holder so TS narrowing inside the closure doesn't conclude
    // the outer `verdict` may be unassigned after withLLMActivity returns —
    // the assignment happens inside the attemptFn lambda which TS cannot
    // see through.
    const verdictHolder: { value?: z.infer<typeof VerdictSchema> } = {}
    const visionPolicy: LLMActivityPolicy = {
      ...DefaultLLMActivityPolicy,
      idleMs: VISION_JUDGE_IDLE_MS,
      firstByteMs: Math.max(VISION_JUDGE_IDLE_MS, DefaultLLMActivityPolicy.firstByteMs),
      maxRetries: { default: 0 },
    }
    try {
      await withLLMActivity(
        {
          sessionID: `vision-judge:${parsed.providerID}/${parsed.modelID}`,
          provider: parsed.providerID,
          model: parsed.modelID,
        },
        visionPolicy,
        new AbortController().signal,
        async (run) => {
          // streamText object output (rule 27 — every LLM interaction is
          // streaming). The SDK enforces VerdictSchema on the streamed JSON;
          // fullStream draining surfaces validation failures. run.signal is
          // composed from external + idle + first-byte + total deadlines; bumps
          // refresh the idle window so a stalled provider (alibaba kimi-k2.5 has
          // a documented 20+ min hang pattern) trips a clean terminal=failed
          // cls=idle instead of wedging the parent build session.
          const result = streamText({
            model: language,
            output: Output.object({ schema: ProviderSchema.output(model, VerdictSchema) }),
            abortSignal: run.signal,
            timeoutMs: false,
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: userPrompt },
                  { type: "text", text: "\n--- REFERENCE (target) ---\n" },
                  { type: "file", mediaType: "image/png", data: referenceBytes },
                  { type: "text", text: "\n--- RENDERED (current attempt) ---\n" },
                  { type: "file", mediaType: "image/png", data: renderedBytes },
                ],
              },
            ],
          })
          for await (const part of result.fullStream) {
            run.bump(chunkHeartbeatKind(part as { type?: string }))
          }
          verdictHolder.value = (await result.output) as z.infer<typeof VerdictSchema>
        },
        () => {},
      )
    } catch (err) {
      const original = err instanceof LLMActivityError ? (err.cause ?? err) : err
      const errMessage = original instanceof Error ? original.message : String(original)
      const errName = original instanceof Error ? original.name : "UnknownError"
      const errStack = original instanceof Error ? original.stack : undefined
      const cause =
        original instanceof Error && "cause" in original ? (original as { cause?: unknown }).cause : undefined
      const causeMessage = cause instanceof Error ? cause.message : cause !== undefined ? String(cause) : undefined
      log.error("vision judge structured stream failed", {
        providerID: parsed.providerID,
        modelID: parsed.modelID,
        errName,
        errMessage,
        causeMessage,
        errStack,
      })
      const failurePath = path.join(outputDir, "vision-judge-failure.json")
      await fs
        .writeFile(
          failurePath,
          JSON.stringify(
            {
              generatedAt: new Date().toISOString(),
              model: `${parsed.providerID}/${parsed.modelID}`,
              referencePath,
              renderedPath,
              errName,
              errMessage,
              causeMessage,
            },
            null,
            2,
          ),
          "utf8",
        )
        .catch(() => undefined)
      throw new Error(
        `webpage_vision_judge: ${errName} — ${errMessage}` +
          (causeMessage ? ` (cause: ${causeMessage})` : "") +
          `. Common causes: (1) the model returned narrative text instead of JSON matching the schema; ` +
          `(2) the model timed out streaming (idle > ${VISION_JUDGE_IDLE_MS}ms — provider stalled); ` +
          `(3) the model rejected the image payload. ` +
          `No verdict was written; downstream gates must treat ${judgePath} as missing until a real verdict is produced. ` +
          `Failure diagnostics were written to ${failurePath} when the filesystem was available.`,
        { cause: original instanceof Error ? original : undefined },
      )
    }

    // Activity returned without throwing → verdictHolder.value is set.
    // Narrow once at the boundary so the rest of the function uses the
    // local `verdict` directly (rule 26 — keep the closure pattern from
    // leaking into the report-rendering code below).
    if (!verdictHolder.value) {
      throw new Error("webpage_vision_judge: structured stream returned without producing a verdict")
    }
    const verdict = verdictHolder.value
    const payload = {
      generatedAt: new Date().toISOString(),
      model: `${parsed.providerID}/${parsed.modelID}`,
      referencePath,
      renderedPath,
      ...verdict,
    }
    await fs.writeFile(judgePath, JSON.stringify(payload, null, 2), "utf8")
    const visualEvidenceBundle = await tryMaterializeVisualEvidenceBundle({
      outputDir,
      taskID: typeof ctx.extra?.taskID === "string" ? ctx.extra.taskID : undefined,
      source: sourceForAgent(ctx.agent),
      projectDirectory: process.cwd(),
    })

    const lines: string[] = [
      `# Vision-judge verdict — ${verdict.accepted ? "✅ accepted" : "❌ not yet accepted"}`,
      "",
      `_Model:_ ${parsed.providerID}/${parsed.modelID}`,
      `_Reference:_ ${referencePath}`,
      `_Rendered:_  ${renderedPath}`,
      `_Verdict file:_ ${judgePath}`,
      visualEvidenceBundle ? `_Visual evidence bundle:_ ${path.join(outputDir, "visual-evidence-bundle.json")}` : "",
      "",
      `**Overall impression:** ${verdict.overall_impression}`,
      "",
    ]
    if (verdict.differences.length === 0) {
      lines.push("_No visible differences._")
    } else {
      lines.push("## Differences (severity-ordered)")
      lines.push("")
      const ordered = [...verdict.differences].sort((a, b) => {
        const rank = (s: string) => (s === "critical" ? 0 : s === "major" ? 1 : 2)
        return rank(a.severity) - rank(b.severity)
      })
      for (const d of ordered) {
        lines.push(`### [${d.severity}] ${d.region}`)
        lines.push(`- **observed:** ${d.observed}`)
        lines.push(`- **expected:** ${d.expected}`)
        lines.push(`- **fix:** ${d.fix_hint}`)
        lines.push("")
      }
    }
    lines.push(
      verdict.accepted
        ? "Acceptance gate passed. You may proceed to `goal_report`."
        : "Acceptance gate NOT passed. Address the **critical** differences first, re-render, then call this tool again.",
    )

    return {
      title: verdict.accepted
        ? `Vision judge: accepted (${verdict.differences.length} minor notes)`
        : `Vision judge: ${verdict.differences.filter((d) => d.severity === "critical").length} critical / ${verdict.differences.filter((d) => d.severity === "major").length} major / ${verdict.differences.filter((d) => d.severity === "minor").length} minor`,
      output: lines.join("\n"),
      metadata: {
        accepted: verdict.accepted,
        differenceCount: verdict.differences.length,
        criticalCount: verdict.differences.filter((d) => d.severity === "critical").length,
        majorCount: verdict.differences.filter((d) => d.severity === "major").length,
        minorCount: verdict.differences.filter((d) => d.severity === "minor").length,
        verdictPath: judgePath,
        visualEvidenceBundlePath: visualEvidenceBundle
          ? path.join(outputDir, "visual-evidence-bundle.json")
          : undefined,
      },
    }
  },
})

function sourceForAgent(agent: string): "frontend_design" | "build" | "integrity" {
  if (agent === "integrity") return "integrity"
  if (agent === "build") return "build"
  return "frontend_design"
}
