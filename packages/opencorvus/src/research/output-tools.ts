import { tool } from "ai"
import { z } from "zod"
import { limitSummary, markdownList } from "@/agent/report"
import { FactCheckItemListSchema, type FactCheckItem } from "@/fact-check/schema"
import {
  ResearchBriefSchema,
  ResearchBundleCitationEntrySchema,
  ResearchBundleEvidenceNoteSchema,
  ResearchBundleInputSchema,
  ResearchBundleMarkdownSectionSchema,
  ResearchBundleSchema,
  ResearchConstraintSchema,
  ResearchDocumentSectionSchema,
  ResearchEvidenceRefSchema,
  ResearchFactSchema,
  ResearchInferenceSchema,
  ResearchOpenQuestionSchema,
  ResearchProblemStatementSchema,
  ResearchScopeSchema,
  ResearchSubpageTaskSchema,
  ResearchUserNeedSchema,
  ResearchWebpageAcceptanceCriterionSchema,
  ResearchWebpageContractSchema,
  ResearchWebpageDataInventorySchema,
  ResearchWebpageFidelityRiskSchema,
  ResearchWebpageFunctionalSurfaceSchema,
  ResearchWebpageInteractionStateSchema,
  ResearchWebpageStyleRequirementSchema,
  ResearchWebpageVisualLayoutSchema,
  researchRequestHash,
  researchSourceDigest,
  validateResearchBriefSemantics,
  type ResearchBrief,
  type ResearchBundle,
  type ResearchBundleInput,
  type ResearchConstraint,
  type ResearchDocumentSection,
  type ResearchEvidenceRef,
  type ResearchFact,
  type ResearchInference,
  type ResearchOpenQuestion,
  type ResearchProblemStatement,
  type ResearchScope,
  type ResearchSubpageTask,
  type ResearchUserNeed,
  type ResearchWebpageAcceptanceCriterion,
  type ResearchWebpageDataInventory,
  type ResearchWebpageFidelityRisk,
  type ResearchWebpageFunctionalSurface,
  type ResearchWebpageInteractionState,
  type ResearchWebpageStyleRequirement,
  type ResearchWebpageVisualLayout,
} from "./schema"

export const ResearchFinalizeSchema = z
  .object({
    final: z.literal(true).describe("Explicit confirmation that all research registrations are complete."),
    fact_check_items: FactCheckItemListSchema.default([]),
  })
  .strict()

const WebpageContractSourceInputSchema = z.object({
  source_url: z.string().min(1),
  reference_image_evidence_ids: z.array(z.string().min(1)).default([]),
})

const ResearchBriefDraftSchema = ResearchBriefSchema.omit({
  metadata: true,
  bundle: true,
}).extend({
  bundle: ResearchBundleInputSchema,
})

export type ResearchDraft = z.infer<typeof ResearchBriefDraftSchema>

export type ResearchSubmit = z.infer<typeof ResearchFinalizeSchema>

export interface ResearchCollector {
  scope?: ResearchScope
  summary?: string
  evidence_index: ResearchEvidenceRef[]
  facts: ResearchFact[]
  inferences: ResearchInference[]
  problem_statements: ResearchProblemStatement[]
  user_needs: ResearchUserNeed[]
  constraints: ResearchConstraint[]
  document_outline: ResearchDocumentSection[]
  webpage_contract_source?: z.infer<typeof WebpageContractSourceInputSchema>
  webpage_functional_surfaces: ResearchWebpageFunctionalSurface[]
  webpage_visual_layout: ResearchWebpageVisualLayout[]
  webpage_style_requirements: ResearchWebpageStyleRequirement[]
  webpage_interaction_states: ResearchWebpageInteractionState[]
  webpage_data_content_inventory: ResearchWebpageDataInventory[]
  webpage_fidelity_acceptance: ResearchWebpageAcceptanceCriterion[]
  webpage_fidelity_risks: ResearchWebpageFidelityRisk[]
  subpage_research_tasks: ResearchSubpageTask[]
  open_questions: ResearchOpenQuestion[]
  bundle: ResearchBundleInput
  draft?: ResearchDraft
  fact_check_items: FactCheckItem[]
  finalized: boolean
  semantic_error?: string
}

function emptyCollector(): ResearchCollector {
  return {
    evidence_index: [],
    facts: [],
    inferences: [],
    problem_statements: [],
    user_needs: [],
    constraints: [],
    document_outline: [],
    webpage_functional_surfaces: [],
    webpage_visual_layout: [],
    webpage_style_requirements: [],
    webpage_interaction_states: [],
    webpage_data_content_inventory: [],
    webpage_fidelity_acceptance: [],
    webpage_fidelity_risks: [],
    subpage_research_tasks: [],
    open_questions: [],
    bundle: {
      full_markdown_sections: [],
      evidence_notes: [],
      citation_map: [],
    },
    fact_check_items: [],
    finalized: false,
  }
}

export function buildResearchBriefFromDraft(input: {
  draft: ResearchDraft
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
    if (missing.length > 0)
      return `bundle.full_markdown_sections "${section.title}" references unknown evidence id(s): ${missing.join(", ")}.`
  }
  for (const note of bundle.evidence_notes) {
    if (!evidenceIDs.has(note.evidence_id))
      return `bundle.evidence_notes references unknown evidence id: ${note.evidence_id}.`
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

function webpageContractFromCollector(collector: ResearchCollector): ResearchDraft["webpage_contract"] | undefined {
  if (!collector.webpage_contract_source) return undefined
  return ResearchWebpageContractSchema.parse({
    ...collector.webpage_contract_source,
    functional_surfaces: collector.webpage_functional_surfaces,
    visual_layout: collector.webpage_visual_layout,
    style_requirements: collector.webpage_style_requirements,
    interaction_states: collector.webpage_interaction_states,
    data_content_inventory: collector.webpage_data_content_inventory,
    fidelity_acceptance: collector.webpage_fidelity_acceptance,
    fidelity_risks: collector.webpage_fidelity_risks,
  })
}

function assembleDraft(collector: ResearchCollector): ResearchDraft {
  return ResearchBriefDraftSchema.parse({
    scope: collector.scope,
    summary: collector.summary,
    evidence_index: collector.evidence_index,
    facts: collector.facts,
    inferences: collector.inferences,
    problem_statements: collector.problem_statements,
    user_needs: collector.user_needs,
    constraints: collector.constraints,
    document_outline: collector.document_outline,
    webpage_contract: webpageContractFromCollector(collector),
    subpage_research_tasks: collector.subpage_research_tasks,
    open_questions: collector.open_questions,
    bundle: collector.bundle,
  })
}

function validateDraftForSubmit(draft: ResearchDraft): string | undefined {
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
    metadata,
    bundle: paths,
  })
  const semanticError = validateResearchBriefSemantics(brief)
  if (semanticError) return `research brief failed semantic validation: ${semanticError}`
  const bundleError = validateResearchBundleInputSemantics(draft.bundle, brief)
  if (bundleError) return `research bundle failed semantic validation: ${bundleError}`
  return undefined
}

function rejectFinalized(collector: ResearchCollector): string | undefined {
  return collector.finalized ? "Error: research brief already finalized; collector is closed." : undefined
}

function upsertByID<T extends { id: string }>(items: T[], item: T): "registered" | "overwritten" {
  const idx = items.findIndex((existing) => existing.id === item.id)
  if (idx >= 0) {
    items[idx] = item
    return "overwritten"
  }
  items.push(item)
  return "registered"
}

function knownFactIDs(collector: ResearchCollector): Set<string> {
  return new Set(collector.facts.map((fact) => fact.id))
}

function unknownFactIDError(collector: ResearchCollector, label: string, ids: readonly string[]): string | undefined {
  const known = knownFactIDs(collector)
  const missing = [...new Set(ids.filter((id) => !known.has(id)))]
  if (missing.length === 0) return undefined
  const knownList = [...known].sort()
  return (
    `Error: ${label} references unknown fact id(s): ${missing.join(", ")}. ` +
    `Register or correct the fact ids first; known fact ids: ${knownList.length ? knownList.join(", ") : "(none)"}. ` +
    "Collector unchanged."
  )
}

function upsertBundleSection(
  collector: ResearchCollector,
  section: z.infer<typeof ResearchBundleMarkdownSectionSchema>,
): string {
  const idx = collector.bundle.full_markdown_sections.findIndex((existing) => existing.title === section.title)
  if (idx >= 0) {
    collector.bundle.full_markdown_sections[idx] = section
    return `OK: bundle section "${section.title}" overwritten (${collector.bundle.full_markdown_sections.length} total)`
  }
  collector.bundle.full_markdown_sections.push(section)
  return `OK: bundle section "${section.title}" registered (${collector.bundle.full_markdown_sections.length} total)`
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
      `## Sources\n${markdownList(draft.evidence_index.map((item) => `${item.id} [${item.kind}/${item.reliability}] ${item.title} - ${item.pointer}`))}`,
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
    set_research_scope: tool({
      description: "Set the brief scope once before registering research items.",
      inputSchema: ResearchScopeSchema,
      execute: async (input) => {
        const closed = rejectFinalized(collector)
        if (closed) return closed
        collector.scope = ResearchScopeSchema.parse(input)
        return "OK: research scope set"
      },
    }),

    set_research_summary: tool({
      description: "Set or replace the compact research summary.",
      inputSchema: z.object({ summary: z.string().min(1) }),
      execute: async ({ summary }) => {
        const closed = rejectFinalized(collector)
        if (closed) return closed
        collector.summary = summary
        return "OK: research summary set"
      },
    }),

    register_research_evidence: tool({
      description: "Register one evidence source. Call once per source or prepared artifact.",
      inputSchema: ResearchEvidenceRefSchema,
      execute: async (input) => {
        const closed = rejectFinalized(collector)
        if (closed) return closed
        const parsed = ResearchEvidenceRefSchema.parse(input)
        const mode = upsertByID(collector.evidence_index, parsed)
        return `OK: evidence "${parsed.id}" ${mode} (${collector.evidence_index.length} total)`
      },
    }),

    register_research_fact: tool({
      description: "Register one source-backed fact.",
      inputSchema: ResearchFactSchema,
      execute: async (input) => {
        const closed = rejectFinalized(collector)
        if (closed) return closed
        const parsed = ResearchFactSchema.parse(input)
        const mode = upsertByID(collector.facts, parsed)
        return `OK: fact "${parsed.id}" ${mode} (${collector.facts.length} total)`
      },
    }),

    register_research_inference: tool({
      description: "Register one inference based on registered fact IDs.",
      inputSchema: ResearchInferenceSchema,
      execute: async (input) => {
        const closed = rejectFinalized(collector)
        if (closed) return closed
        const parsed = ResearchInferenceSchema.parse(input)
        const factErr = unknownFactIDError(collector, `inference "${parsed.id}".based_on_fact_ids`, parsed.based_on_fact_ids)
        if (factErr) return factErr
        const mode = upsertByID(collector.inferences, parsed)
        return `OK: inference "${parsed.id}" ${mode} (${collector.inferences.length} total)`
      },
    }),

    register_research_problem: tool({
      description: "Register one problem statement derived from the evidence.",
      inputSchema: ResearchProblemStatementSchema,
      execute: async (input) => {
        const closed = rejectFinalized(collector)
        if (closed) return closed
        const parsed = ResearchProblemStatementSchema.parse(input)
        const factErr = unknownFactIDError(collector, `problem "${parsed.id}".fact_ids`, parsed.fact_ids)
        if (factErr) return factErr
        const mode = upsertByID(collector.problem_statements, parsed)
        return `OK: problem "${parsed.id}" ${mode} (${collector.problem_statements.length} total)`
      },
    }),

    register_research_need: tool({
      description: "Register one user need derived from task and evidence.",
      inputSchema: ResearchUserNeedSchema,
      execute: async (input) => {
        const closed = rejectFinalized(collector)
        if (closed) return closed
        const parsed = ResearchUserNeedSchema.parse(input)
        const factErr = unknownFactIDError(collector, `need "${parsed.id}".fact_ids`, parsed.fact_ids)
        if (factErr) return factErr
        const mode = upsertByID(collector.user_needs, parsed)
        return `OK: need "${parsed.id}" ${mode} (${collector.user_needs.length} total)`
      },
    }),

    register_research_constraint: tool({
      description: "Register one constraint derived from task and evidence.",
      inputSchema: ResearchConstraintSchema,
      execute: async (input) => {
        const closed = rejectFinalized(collector)
        if (closed) return closed
        const parsed = ResearchConstraintSchema.parse(input)
        const factErr = unknownFactIDError(collector, `constraint "${parsed.id}".fact_ids`, parsed.fact_ids)
        if (factErr) return factErr
        const mode = upsertByID(collector.constraints, parsed)
        return `OK: constraint "${parsed.id}" ${mode} (${collector.constraints.length} total)`
      },
    }),

    register_research_document_section: tool({
      description: "Register one downstream document-outline section.",
      inputSchema: ResearchDocumentSectionSchema,
      execute: async (input) => {
        const closed = rejectFinalized(collector)
        if (closed) return closed
        const parsed = ResearchDocumentSectionSchema.parse(input)
        const mode = upsertByID(collector.document_outline, parsed)
        return `OK: document section "${parsed.id}" ${mode} (${collector.document_outline.length} total)`
      },
    }),

    set_webpage_contract_source: tool({
      description: "Set webpage contract source URL and visual reference evidence IDs.",
      inputSchema: WebpageContractSourceInputSchema,
      execute: async (input) => {
        const closed = rejectFinalized(collector)
        if (closed) return closed
        collector.webpage_contract_source = WebpageContractSourceInputSchema.parse(input)
        return "OK: webpage contract source set"
      },
    }),

    register_webpage_functional_surface: tool({
      description: "Register one webpage functional surface work packet.",
      inputSchema: ResearchWebpageFunctionalSurfaceSchema,
      execute: async (input) => {
        const closed = rejectFinalized(collector)
        if (closed) return closed
        const parsed = ResearchWebpageFunctionalSurfaceSchema.parse(input)
        const mode = upsertByID(collector.webpage_functional_surfaces, parsed)
        return `OK: webpage functional surface "${parsed.id}" ${mode}`
      },
    }),

    register_webpage_visual_layout: tool({
      description: "Register one webpage visual layout work packet.",
      inputSchema: ResearchWebpageVisualLayoutSchema,
      execute: async (input) => {
        const closed = rejectFinalized(collector)
        if (closed) return closed
        const parsed = ResearchWebpageVisualLayoutSchema.parse(input)
        const mode = upsertByID(collector.webpage_visual_layout, parsed)
        return `OK: webpage visual layout "${parsed.id}" ${mode}`
      },
    }),

    register_webpage_style_requirement: tool({
      description: "Register one webpage style requirement work packet.",
      inputSchema: ResearchWebpageStyleRequirementSchema,
      execute: async (input) => {
        const closed = rejectFinalized(collector)
        if (closed) return closed
        const parsed = ResearchWebpageStyleRequirementSchema.parse(input)
        const mode = upsertByID(collector.webpage_style_requirements, parsed)
        return `OK: webpage style requirement "${parsed.id}" ${mode}`
      },
    }),

    register_webpage_interaction_state: tool({
      description: "Register one webpage interaction-state work packet.",
      inputSchema: ResearchWebpageInteractionStateSchema,
      execute: async (input) => {
        const closed = rejectFinalized(collector)
        if (closed) return closed
        const parsed = ResearchWebpageInteractionStateSchema.parse(input)
        const mode = upsertByID(collector.webpage_interaction_states, parsed)
        return `OK: webpage interaction state "${parsed.id}" ${mode}`
      },
    }),

    register_webpage_data_inventory: tool({
      description: "Register one webpage data/content inventory work packet.",
      inputSchema: ResearchWebpageDataInventorySchema,
      execute: async (input) => {
        const closed = rejectFinalized(collector)
        if (closed) return closed
        const parsed = ResearchWebpageDataInventorySchema.parse(input)
        const mode = upsertByID(collector.webpage_data_content_inventory, parsed)
        return `OK: webpage data inventory "${parsed.id}" ${mode}`
      },
    }),

    register_webpage_fidelity_acceptance: tool({
      description: "Register one webpage fidelity acceptance work packet.",
      inputSchema: ResearchWebpageAcceptanceCriterionSchema,
      execute: async (input) => {
        const closed = rejectFinalized(collector)
        if (closed) return closed
        const parsed = ResearchWebpageAcceptanceCriterionSchema.parse(input)
        const mode = upsertByID(collector.webpage_fidelity_acceptance, parsed)
        return `OK: webpage fidelity acceptance "${parsed.id}" ${mode}`
      },
    }),

    register_webpage_fidelity_risk: tool({
      description: "Register one webpage fidelity risk.",
      inputSchema: ResearchWebpageFidelityRiskSchema,
      execute: async (input) => {
        const closed = rejectFinalized(collector)
        if (closed) return closed
        const parsed = ResearchWebpageFidelityRiskSchema.parse(input)
        const mode = upsertByID(collector.webpage_fidelity_risks, parsed)
        return `OK: webpage fidelity risk "${parsed.id}" ${mode}`
      },
    }),

    register_subpage_research_task: tool({
      description: "Register one independent subpage or same-page deep-state research task.",
      inputSchema: ResearchSubpageTaskSchema,
      execute: async (input) => {
        const closed = rejectFinalized(collector)
        if (closed) return closed
        const parsed = ResearchSubpageTaskSchema.parse(input)
        const mode = upsertByID(collector.subpage_research_tasks, parsed)
        return `OK: subpage research task "${parsed.id}" ${mode}`
      },
    }),

    register_research_open_question: tool({
      description: "Register one open question.",
      inputSchema: ResearchOpenQuestionSchema,
      execute: async (input) => {
        const closed = rejectFinalized(collector)
        if (closed) return closed
        const parsed = ResearchOpenQuestionSchema.parse(input)
        const factErr = unknownFactIDError(collector, `open_question "${parsed.id}".related_fact_ids`, parsed.related_fact_ids)
        if (factErr) return factErr
        const mode = upsertByID(collector.open_questions, parsed)
        return `OK: open question "${parsed.id}" ${mode} (${collector.open_questions.length} total)`
      },
    }),

    register_research_bundle_section: tool({
      description: "Register one rendered research-bundle markdown section.",
      inputSchema: ResearchBundleMarkdownSectionSchema,
      execute: async (input) => {
        const closed = rejectFinalized(collector)
        if (closed) return closed
        return upsertBundleSection(collector, ResearchBundleMarkdownSectionSchema.parse(input))
      },
    }),

    register_research_evidence_note: tool({
      description: "Register one structured evidence note for evidence.json.",
      inputSchema: ResearchBundleEvidenceNoteSchema,
      execute: async (input) => {
        const closed = rejectFinalized(collector)
        if (closed) return closed
        const parsed = ResearchBundleEvidenceNoteSchema.parse(input)
        const idx = collector.bundle.evidence_notes.findIndex((existing) => existing.evidence_id === parsed.evidence_id)
        if (idx >= 0) {
          collector.bundle.evidence_notes[idx] = parsed
          return `OK: evidence note "${parsed.evidence_id}" overwritten`
        }
        collector.bundle.evidence_notes.push(parsed)
        return `OK: evidence note "${parsed.evidence_id}" registered (${collector.bundle.evidence_notes.length} total)`
      },
    }),

    register_research_citation: tool({
      description: "Register one claim-to-evidence citation for citation-map.json.",
      inputSchema: ResearchBundleCitationEntrySchema,
      execute: async (input) => {
        const closed = rejectFinalized(collector)
        if (closed) return closed
        const parsed = ResearchBundleCitationEntrySchema.parse(input)
        const idx = collector.bundle.citation_map.findIndex((existing) => existing.claim_id === parsed.claim_id)
        if (idx >= 0) {
          collector.bundle.citation_map[idx] = parsed
          return `OK: citation "${parsed.claim_id}" overwritten`
        }
        collector.bundle.citation_map.push(parsed)
        return `OK: citation "${parsed.claim_id}" registered (${collector.bundle.citation_map.length} total)`
      },
    }),

    submit_research_brief: tool({
      description:
        "Finalize research after all register_* calls are complete. Call with final=true; include fact_check_items only for unverified factual claims.",
      inputSchema: ResearchFinalizeSchema,
      execute: async (rawInput) => {
        if (collector.finalized)
          return "Error: research brief already finalized; duplicate submit_research_brief ignored."
        const { fact_check_items } = ResearchFinalizeSchema.parse(rawInput)
        let draft: ResearchDraft
        try {
          draft = assembleDraft(collector)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          collector.semantic_error = msg
          return `Error: research brief is incomplete or malformed: ${msg}`
        }
        const validationError = validateDraftForSubmit(draft)
        if (validationError) {
          collector.semantic_error = validationError
          return `Error: ${validationError}`
        }
        collector.draft = draft
        collector.fact_check_items = fact_check_items ?? []
        collector.finalized = true
        collector.semantic_error = undefined
        const subpageTasks = draft.subpage_research_tasks?.length ?? 0
        const blocking = draft.open_questions.filter((item) => item.blocking).length
        const webpageContract = draft.webpage_contract ? "yes" : "no"
        return (
          `PASS: research brief finalized (sources=${draft.evidence_index.length}, facts=${draft.facts.length}, ` +
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

export function researchBundleFromDraft(draft: ResearchDraft): ResearchBundle {
  return materializeResearchBundle(draft.bundle)
}
