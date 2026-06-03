import { tool } from "ai"
import { z } from "zod"
import { BuildAgent } from "@/build/agent"
import type { BuildResult } from "@/build/types"
import { requireTask, type TaskRow } from "@/engine/store"
import type { ResearchAgent } from "@/research/agent"
import type { WebpagePrdEvidence } from "@/research/webpage-prd-evidence"

type BuildRun = typeof BuildAgent.run

export type FrontendResearchBuildDelegationInput = Pick<
  ResearchAgent.RunInput,
  "title" | "request" | "sourceUrls" | "focus" | "reason" | "taskID" | "parentSessionID" | "model" | "signal"
> & {
  webpagePrdEvidence?: WebpagePrdEvidence
  getParentSessionID?: () => string | undefined
  runBuild?: BuildRun
  task?: TaskRow
}

const DelegateFrontendResearchBuildInputSchema = z.object({
  title: z.string().min(1).describe("Short label for this delegated investigation packet."),
  objective: z.string().min(1).describe("The exact webpage research question build must investigate."),
  source_urls: z
    .array(z.string().min(1))
    .default([])
    .describe("URLs relevant to this delegated packet. Prefer a focused subset."),
  focus: z.string().optional().describe("Optional narrowed scope, component, state, viewport, or subpage focus."),
  expected_output: z
    .string()
    .min(1)
    .describe("The concrete evidence fields frontend-research needs back from build."),
})

export function createFrontendResearchBuildDelegationTools(input: FrontendResearchBuildDelegationInput) {
  const runBuild = input.runBuild ?? BuildAgent.run
  return {
    delegate_deep_research_to_build: tool({
      description:
        "Delegate a scoped frontend webpage research packet to the build agent. " +
        "Use this for source-backed investigation; frontend-research organizes the packets and synthesizes the final brief.",
      inputSchema: DelegateFrontendResearchBuildInputSchema,
      execute: async ({ title, objective, source_urls, focus, expected_output }) => {
        const task = input.task ?? (input.taskID ? requireTask(input.taskID) : undefined)
        if (!task) {
          return "Error: delegate_deep_research_to_build requires taskID or task so build can run under the current task."
        }
        const out = await runBuild({
          target: {
            kind: "request",
            text: renderDelegatedBuildRequest({
              taskTitle: input.title,
              taskRequest: input.request,
              coordinatorReason: input.reason,
              coordinatorFocus: input.focus,
              coordinatorSourceUrls: input.sourceUrls ?? [],
              title,
              objective,
              sourceUrls: source_urls,
              focus,
              expectedOutput: expected_output,
              webpagePrdEvidence: input.webpagePrdEvidence,
            }),
          },
          task,
          parentSessionID: input.getParentSessionID?.() ?? input.parentSessionID,
          model: input.model,
          signal: input.signal,
        })
        return renderDelegatedBuildResult(out.result, out.sessionID)
      },
    }),
  }
}

function renderDelegatedBuildRequest(input: {
  taskTitle: string
  taskRequest: string
  coordinatorReason?: string
  coordinatorFocus?: string
  coordinatorSourceUrls: string[]
  title: string
  objective: string
  sourceUrls: string[]
  focus?: string
  expectedOutput: string
  webpagePrdEvidence?: WebpagePrdEvidence
}): string {
  const sections: string[] = [
    "# Frontend Research Deep Investigation Delegation",
    "",
    "You are build acting as the investigation worker for frontend-research.",
    "This is a bounded no-change research packet: inspect only the packet scope and return detailed findings through `report_build_result.summary`.",
    "Do not edit, create, commit, or merge project files for this packet. If file mutation becomes necessary, report `status=\"failed\"`, explain why, and keep `files_changed=[]`.",
    "Do not crawl the full site, enumerate unrelated menus, or keep expanding the investigation after the requested evidence fields are answered.",
    "",
    "## Parent Task",
    "",
    `Title: ${input.taskTitle}`,
    "",
    input.taskRequest,
    "",
    "## Why Frontend Research Delegated This",
    "",
    input.coordinatorReason?.trim() || "Frontend-research needs build to perform the source-backed investigation before it can synthesize the final brief.",
  ]
  if (input.coordinatorFocus?.trim()) {
    sections.push("", "Coordinator focus:", "", input.coordinatorFocus.trim())
  }
  if (input.coordinatorSourceUrls.length > 0) {
    sections.push("", "Coordinator source URLs:", "", input.coordinatorSourceUrls.map((url) => `- ${url}`).join("\n"))
  }
  sections.push(
    "",
    "## Delegated Packet",
    "",
    `Title: ${input.title}`,
    "",
    `Objective: ${input.objective}`,
    "",
    "Expected output:",
    "",
    input.expectedOutput,
  )
  if (input.focus?.trim()) {
    sections.push("", "Packet focus:", "", input.focus.trim())
  }
  if (input.sourceUrls.length > 0) {
    sections.push("", "Packet source URLs:", "", input.sourceUrls.map((url) => `- ${url}`).join("\n"))
  }
  const evidence = renderDelegatedBuildEvidenceSection(input.webpagePrdEvidence)
  if (evidence) sections.push(evidence)
  sections.push(
    "## Investigation Budget",
    "",
    "Use the smallest read-only evidence set that answers this packet. Prefer prepared artifact excerpts when present.",
    "When live URL inspection is needed, run at most three focused read-only checks for this packet, then stop investigating.",
    "Do not use implementation, edit, write, merge, task-spawn, or broad crawl behavior. This worker only supplies evidence back to frontend-research.",
    "If the packet cannot be answered within this bounded pass, return `status=\"failed\"` with the exact missing evidence instead of continuing to browse.",
    "",
    "## Report Contract",
    "",
    "Return `status=\"passed\"` only when the investigation is complete enough for frontend-research to cite.",
    "Put the full evidence-backed research report in `summary`; it may be multi-section Markdown for this delegated investigation.",
    "Call `report_build_result` immediately after the bounded checks; do not start another research loop after the summary is sufficient.",
    "Use `tests[]` for real commands or checks you ran. Use `fact_check_items[]` for any factual claim you could not verify.",
    "Keep `files_changed=[]` unless you are reporting `status=\"failed\"` because a file mutation would be required.",
  )
  return sections.join("\n")
}

function renderDelegatedBuildEvidenceSection(evidence: WebpagePrdEvidence | undefined): string | undefined {
  if (!evidence) return undefined
  const artifactList = evidence.artifacts.map((artifact) => `- ${artifact}`).join("\n")
  const excerpts = evidence.excerpts
    .map((item) =>
      [
        `### ${item.label}`,
        `Path: ${item.relativePath}`,
        item.clipped ? `Excerpt: clipped from ${item.originalChars} chars.` : "Excerpt: complete.",
        "",
        "```",
        item.excerpt,
        "```",
      ].join("\n"),
    )
    .join("\n\n")
  return [
    "# Prepared Webpage PRD Evidence",
    "",
    `Source URL: ${evidence.url}`,
    `Evidence status: ${evidence.status}`,
    `Mirror evidence root: ${evidence.mirrorRelative}`,
    `Source package root: ${evidence.sourcePackageRelative}`,
    `Visual reference image: ${evidence.referenceImageRelative}`,
    "",
    "Use these rendered artifacts as the starting evidence for this delegated investigation packet.",
    "Report concrete findings and cite artifact paths, evidence ids, selectors, bounds, labels, values, and uncertainty in your summary.",
    "Do not follow frontend-research terminal contracts here; your only terminal contract is `report_build_result`.",
    "",
    "## Artifact Paths",
    artifactList || "- none",
    "",
    "## Evidence Excerpts",
    excerpts || "- none",
  ].join("\n")
}

function renderDelegatedBuildResult(result: BuildResult, sessionID: string): string {
  const lines: string[] = [
    `build_session: ${sessionID}`,
    `status: ${result.status}`,
    "",
    "summary:",
    result.summary,
  ]
  if (result.tests.length > 0) {
    lines.push("", "checks:")
    for (const test of result.tests) {
      lines.push(`- ${test.name}: ${test.passed ? "passed" : "failed"}${test.detail ? ` - ${test.detail}` : ""}`)
    }
  }
  if (result.files_changed.length > 0) {
    lines.push("", "files_changed:")
    for (const file of result.files_changed) {
      lines.push(`- ${file.path}: ${file.summary} (${file.reason})`)
    }
  }
  if (result.status === "failed") {
    lines.push("", `error: ${result.error}`)
  }
  if (result.fact_check_items.length > 0) {
    lines.push("", "fact_check_items:")
    for (const item of result.fact_check_items) {
      lines.push(`- ${item.claim} [${item.category}/${item.confidence}]`)
    }
  }
  return lines.join("\n")
}
