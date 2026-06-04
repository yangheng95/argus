import { tool } from "ai"
import { z } from "zod"
import { limitSummary, markdownList } from "@/agent/report"
import { FactCheckItemListSchema, type FactCheckItem } from "@/fact-check/schema"
import {
  ResearchBriefSchema,
  ResearchBundleInputSchema,
  ResearchBundleSchema,
  researchRequestHash,
  researchSourceDigest,
  validateResearchBriefSemantics,
  type ResearchBrief,
  type ResearchBundle,
  type ResearchBundleInput,
} from "./schema"

export const ResearchSubmitSchema = ResearchBriefSchema.omit({
  metadata: true,
  bundle: true,
}).extend({
  bundle: ResearchBundleInputSchema,
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

function knownResearchClaimIDs(brief: ResearchBrief): Set<string> {
  const ids = new Set<string>()
  for (const item of brief.facts) ids.add(item.id)
  for (const item of brief.inferences) ids.add(item.id)
  for (const item of brief.problem_statements) ids.add(item.id)
  for (const item of brief.user_needs) ids.add(item.id)
  for (const item of brief.constraints) ids.add(item.id)
  for (const item of brief.document_outline) ids.add(item.id)
  for (const item of brief.open_questions) ids.add(item.id)
  const contract = brief.webpage_contract
  if (contract) {
    for (const item of contract.functional_surfaces) ids.add(item.id)
    for (const item of contract.visual_layout) ids.add(item.id)
    for (const item of contract.style_requirements) ids.add(item.id)
    for (const item of contract.interaction_states) ids.add(item.id)
    for (const item of contract.data_content_inventory) ids.add(item.id)
    for (const item of contract.fidelity_acceptance) ids.add(item.id)
    for (const item of contract.fidelity_risks) ids.add(item.id)
  }
  for (const item of brief.subpage_research_tasks) ids.add(item.id)
  return ids
}

function validateResearchBundleInputSemantics(bundle: ResearchBundleInput, brief: ResearchBrief): string | undefined {
  const evidenceIDs = new Set(brief.evidence_index.map((item) => item.id))
  const claimIDs = knownResearchClaimIDs(brief)
  for (const section of bundle.full_markdown_sections) {
    const missing = section.evidence_ids.filter((id) => !evidenceIDs.has(id))
    if (missing.length > 0) return `bundle.full_markdown_sections "${section.title}" references unknown evidence id(s): ${missing.join(", ")}.`
  }
  for (const note of bundle.evidence_notes) {
    if (!evidenceIDs.has(note.evidence_id)) return `bundle.evidence_notes references unknown evidence id: ${note.evidence_id}.`
  }
  for (const entry of bundle.citation_map) {
    const missingEvidence = entry.evidence_ids.filter((id) => !evidenceIDs.has(id))
    if (missingEvidence.length > 0) {
      return `bundle.citation_map "${entry.claim_id}" references unknown evidence id(s): ${missingEvidence.join(", ")}.`
    }
    if (!claimIDs.has(entry.claim_id)) return `bundle.citation_map references unknown claim id: ${entry.claim_id}.`
  }
  return undefined
}

function renderResearchBundleMarkdown(bundle: ResearchBundleInput): string {
  return bundle.full_markdown_sections
    .map((section) => {
      const evidenceLine = section.evidence_ids.length > 0 ? [`Evidence: ${section.evidence_ids.join(", ")}`] : []
      return [`## ${section.title}`, ...evidenceLine, "", markdownList(section.points)].join("\n")
    })
    .join("\n\n")
}

export function materializeResearchBundle(bundle: ResearchBundleInput): ResearchBundle {
  return ResearchBundleSchema.parse({
    full_markdown: renderResearchBundleMarkdown(bundle),
    evidence_json: JSON.stringify({ evidence_notes: bundle.evidence_notes }, null, 2),
    citation_map_json: JSON.stringify({ citations: bundle.citation_map }, null, 2),
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
  const webpageContract = draft.webpage_contract
  return {
    summary: limitSummary(
      `research brief submitted: sources=${draft.evidence_index.length}, facts=${draft.facts.length}, webpage_contract=${webpageContract ? "yes" : "no"}, subpage_research_tasks=${subpageTasks.length}, blocking_open_questions=${blocking.length}`,
    ),
    detail: [
      `## Summary\n${draft.summary}`,
      `## Sources\n${markdownList(draft.evidence_index.map((item) => `${item.id} [${item.kind}/${item.reliability}] ${item.title} — ${item.pointer}`))}`,
      `## Problem Statements\n${markdownList(draft.problem_statements.map((item) => `${item.id}: ${item.statement}`))}`,
      webpageContract
        ? `## Webpage Contract\n${markdownList([
          `source_url: ${webpageContract.source_url}`,
          `functional_surfaces=${webpageContract.functional_surfaces.length}`,
          `visual_layout=${webpageContract.visual_layout.length}`,
          `style_requirements=${webpageContract.style_requirements.length}`,
          `fidelity_acceptance=${webpageContract.fidelity_acceptance.length}`,
          `fidelity_risks=${webpageContract.fidelity_risks.length}`,
        ])}`
        : "## Webpage Contract\n- none",
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
      execute: async (rawInput) => {
        const { fact_check_items, ...draft } = ResearchSubmitSchema.parse(rawInput)
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
        const bundleError = validateResearchBundleInputSemantics(draft.bundle, brief)
        if (bundleError) {
          collector.semantic_error = bundleError
          return `Error: research bundle failed semantic validation: ${bundleError}`
        }
        collector.draft = draft
        collector.fact_check_items = fact_check_items ?? []
        collector.finalized = true
        collector.semantic_error = undefined
        const subpageTasks = draft.subpage_research_tasks?.length ?? 0
        const blocking = draft.open_questions.filter((item) => item.blocking).length
        const webpageContract = draft.webpage_contract ? "yes" : "no"
        return (
          `PASS: research brief submitted (sources=${draft.evidence_index.length}, facts=${draft.facts.length}, ` +
          `webpage_contract=${webpageContract}, subpage_research_tasks=${subpageTasks}, blocking_open_questions=${blocking}, fact_check_items=${collector.fact_check_items.length}).`
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
  return materializeResearchBundle(draft.bundle)
}
