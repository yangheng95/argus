import { tool } from "ai"
import { z } from "zod"
import { limitSummary, markdownList } from "@/agent/report"
import { FactCheckItemListSchema, type FactCheckItem } from "@/fact-check/schema"
import {
  ResearchBriefSchema,
  ResearchBundleSchema,
  researchRequestHash,
  researchSourceDigest,
  validateResearchBriefSemantics,
  type ResearchBrief,
  type ResearchBundle,
} from "./schema"

export const ResearchSubmitSchema = ResearchBriefSchema.omit({
  metadata: true,
  bundle: true,
}).extend({
  bundle: ResearchBundleSchema,
  fact_check_items: FactCheckItemListSchema.default([]),
})

export type ResearchSubmit = z.infer<typeof ResearchSubmitSchema>

export interface ResearchCollector {
  draft?: Omit<ResearchSubmit, "fact_check_items">
  fact_check_items: FactCheckItem[]
  finalized: boolean
  semantic_error?: string
}

function emptyCollector(): ResearchCollector {
  return {
    fact_check_items: [],
    finalized: false,
  }
}

export function buildResearchBriefFromDraft(input: {
  draft: Omit<ResearchSubmit, "fact_check_items">
  metadata: Omit<ResearchBrief["metadata"], "source_digest">
  bundlePaths: ResearchBrief["bundle"]
}): ResearchBrief {
  const brief = parseResearchBriefWithCanonicalDigest({
    ...input.draft,
    metadata: {
      ...input.metadata,
    },
    bundle: input.bundlePaths,
  })
  const semanticError = validateResearchBriefSemantics(brief)
  if (semanticError) throw new Error(`research brief failed semantic validation: ${semanticError}`)
  return brief
}

function parseResearchBriefWithCanonicalDigest(input: unknown): ResearchBrief {
  const parsed = ResearchBriefSchema.parse({
    ...(input as Record<string, unknown>),
    metadata: {
      ...((input as Record<string, unknown>).metadata as Record<string, unknown>),
      source_digest: "pending-canonical-digest",
    },
  })
  return ResearchBriefSchema.parse({
    ...parsed,
    metadata: {
      ...parsed.metadata,
      source_digest: researchSourceDigest(parsed.evidence_index),
    },
  })
}

export function buildResearchReport(collector: ResearchCollector) {
  const draft = collector.draft
  if (!draft) {
    return {
      summary: limitSummary("research did not submit a brief"),
      detail: collector.semantic_error ?? "No research brief was submitted before the session ended.",
    }
  }
  const blocking = draft.open_questions.filter((item) => item.blocking)
  const subpageTasks = draft.subpage_research_tasks ?? []
  return {
    summary: limitSummary(
      `research brief submitted: sources=${draft.evidence_index.length}, facts=${draft.facts.length}, subpage_research_tasks=${subpageTasks.length}, blocking_open_questions=${blocking.length}`,
    ),
    detail: [
      `## Summary\n${draft.summary}`,
      `## Sources\n${markdownList(draft.evidence_index.map((item) => `${item.id} [${item.kind}/${item.reliability}] ${item.title} — ${item.pointer}`))}`,
      `## Problem Statements\n${markdownList(draft.problem_statements.map((item) => `${item.id}: ${item.statement}`))}`,
      subpageTasks.length > 0
        ? `## Subpage Research Tasks\n${markdownList(subpageTasks.map((item) => `${item.id}: ${item.url} - ${item.suggested_focus}`))}`
        : "## Subpage Research Tasks\n- none",
      blocking.length > 0
        ? `## Blocking Open Questions\n${markdownList(blocking.map((item) => `${item.id}: ${item.question}`))}`
        : "## Blocking Open Questions\n- none",
    ].join("\n\n"),
  }
}

export function createResearchOutputTools() {
  let collector = emptyCollector()
  const tools = {
    submit_research_brief: tool({
      description:
        "Submit the compact research brief and full evidence bundle content. Include subpage_research_tasks for independent linked pages needing separate study. The brief is evidence input only; do not name a next tool or route. Use fact_check_items only for factual claims not verified through tools.",
      inputSchema: ResearchSubmitSchema,
      execute: async ({ fact_check_items, ...draft }) => {
        const metadata = {
          research_session_id: "semantic-validation",
          created_for_message_id: "semantic-validation",
          request_hash: researchRequestHash("semantic-validation"),
          created_at: new Date(0).toISOString(),
        }
        const paths = {
          full_markdown_path: "semantic-validation/full.md",
          evidence_json_path: "semantic-validation/evidence.json",
          citation_map_path: "semantic-validation/citations.json",
        }
        const brief = parseResearchBriefWithCanonicalDigest({
          ...draft,
          metadata: {
            ...metadata,
          },
          bundle: paths,
        })
        const semanticError = validateResearchBriefSemantics(brief)
        if (semanticError) {
          collector.semantic_error = semanticError
          return `Error: research brief failed semantic validation: ${semanticError}`
        }
        collector.draft = draft
        collector.fact_check_items = fact_check_items ?? []
        collector.finalized = true
        collector.semantic_error = undefined
        const subpageTasks = draft.subpage_research_tasks?.length ?? 0
        const blocking = draft.open_questions.filter((item) => item.blocking).length
        return (
          `PASS: research brief submitted (sources=${draft.evidence_index.length}, facts=${draft.facts.length}, ` +
          `subpage_research_tasks=${subpageTasks}, blocking_open_questions=${blocking}, fact_check_items=${collector.fact_check_items.length}).`
        )
      },
    }),
  }
  return {
    tools,
    getCollector: () => collector,
    buildReport: () => buildResearchReport(collector),
    reset() {
      collector = emptyCollector()
      return collector
    },
  }
}

export function researchBundleFromDraft(draft: Omit<ResearchSubmit, "fact_check_items">): ResearchBundle {
  return draft.bundle
}
