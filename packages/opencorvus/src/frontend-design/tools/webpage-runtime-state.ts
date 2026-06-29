/**
 * `webpage_runtime_state` tool — captures browser runtime state evidence.
 *
 * It writes factual scroll/viewport interaction evidence only. It does not
 * write PRD, requirements, implementation code, or acceptance verdicts.
 */

import path from "node:path"
import z from "zod"

import { Tool } from "../../tool/tool"
import { DEFAULT_WEBPAGE_EVIDENCE_VIEWPORT } from "@/browser/webpage/default-viewport"
import { captureWebpageRuntimeStateEvidence } from "@/browser/webpage/runtime-state"
import { resolveWebpageEvidenceOutputDir, DEFAULT_WEBPAGE_EVIDENCE_SUBDIR } from "./output-dir"

export const WebpageRuntimeStateTool = Tool.define("webpage_runtime_state", {
  description: `Capture factual browser runtime evidence for scroll-triggered and interactive webpage states.

Writes:
  - source-ir/interaction-state-snapshots.json
  - interaction-states/initial.png
  - interaction-states/scroll-25.png
  - interaction-states/scroll-50.png
  - interaction-states/scroll-75.png

Use this after URL evidence exists when frontend-research or frontend-design needs evidence for sticky/floating navigation, active/selected tabs, expanded controls, viewport-persistent elements, or scroll-state layout. This tool does not generate PRD prose and does not implement UI.`,
  parameters: z.object({
    url: z.string().url().describe("The source webpage URL to capture in a browser."),
    outputDir: z
      .string()
      .describe(
        `Directory to write runtime state evidence into. Defaults to task-scoped \`${DEFAULT_WEBPAGE_EVIDENCE_SUBDIR}\`. Do not set this during task sessions; overrides are for benchmarks/tests and task-session overrides must stay under \`${DEFAULT_WEBPAGE_EVIDENCE_SUBDIR}\`.`,
      )
      .optional(),
    viewport_width: z
      .number()
      .int()
      .positive()
      .describe(`Viewport width. Default ${DEFAULT_WEBPAGE_EVIDENCE_VIEWPORT.width}.`)
      .optional(),
    viewport_height: z
      .number()
      .int()
      .positive()
      .describe(`Viewport height. Default ${DEFAULT_WEBPAGE_EVIDENCE_VIEWPORT.height}.`)
      .optional(),
  }),
  async execute(params, ctx) {
    const outputDir = await resolveWebpageEvidenceOutputDir({ override: params.outputDir, sessionID: ctx.sessionID })
    await ctx.ask({
      permission: "webpage_runtime_state",
      patterns: [params.url],
      always: ["*"],
      metadata: { url: params.url, outputDir },
    })

    const viewport = {
      width: params.viewport_width ?? DEFAULT_WEBPAGE_EVIDENCE_VIEWPORT.width,
      height: params.viewport_height ?? DEFAULT_WEBPAGE_EVIDENCE_VIEWPORT.height,
    }
    const evidence = await captureWebpageRuntimeStateEvidence({
      url: params.url,
      outputDir,
      viewport,
      signal: ctx.abort,
    })
    const evidencePath = path.join(outputDir, "source-ir", "interaction-state-snapshots.json")
    return {
      title: `Captured runtime state evidence (${evidence.snapshots.length} snapshots)`,
      output: [
        "# Runtime state evidence captured",
        "",
        `- URL: ${params.url}`,
        `- Viewport: ${viewport.width}x${viewport.height}`,
        `- Evidence: \`${evidencePath}\``,
        `- Snapshots: ${evidence.snapshots.map((snapshot) => snapshot.id).join(", ")}`,
        `- Observations: ${evidence.observations.length}`,
        "",
        "This is factual browser evidence for frontend-research and implementation verification. It is not PRD prose.",
      ].join("\n"),
      metadata: {
        evidencePath,
        snapshots: evidence.snapshots.length,
        observations: evidence.observations.length,
      },
    }
  },
})
