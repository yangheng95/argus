import z from "zod"
import { FactCheckItemListSchema } from "@/fact-check/schema"
import { VISUAL_QA_PRODUCT_DESIGN_PRINCIPLE_IDS } from "./product-design-principles"

export const VisualQaSeveritySchema = z.enum(["critical", "major", "minor"])
export const VisualQaFindingStatusSchema = z.enum(["open", "repaired", "deferred"])

export const VisualQaViewportSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  device_scale_factor: z.number().positive().optional(),
})

export const VisualQaDomBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
})

export const VisualQaCoverageSchema = z.object({
  region: z.string().min(1).describe("Visible region, route, component family, or interaction surface checked."),
  viewports: z.array(VisualQaViewportSchema).default([]),
  states: z
    .array(z.string().min(1))
    .default([])
    .describe("Runtime states checked: default, narrow, hover, modal open, loading, error, etc."),
  source_refs: z
    .array(z.string().min(1))
    .default([])
    .describe("Frontend-design/build/source artifact refs used as the source of truth."),
  evidence_refs: z
    .array(z.string().min(1))
    .default([])
    .describe("Fresh screenshot, visual comparison, console/network, or command evidence refs."),
  notes: z.string().min(1),
})

export const VisualQaFindingSchema = z.object({
  id: z.string().min(1),
  severity: VisualQaSeveritySchema,
  status: VisualQaFindingStatusSchema,
  claim: z.string().min(1),
  reproduction: z.string().min(1),
  region: z.string().min(1),
  source_refs: z.array(z.string().min(1)).default([]),
  evidence_refs: z.array(z.string().min(1)).default([]),
  repair_refs: z
    .array(z.string().min(1))
    .default([])
    .describe("Changed files, commits, or verification refs when repaired."),
})

export const VisualQaProductionBlockerSchema = z.object({
  id: z.string().min(1),
  principle_ids: z
    .array(z.enum(VISUAL_QA_PRODUCT_DESIGN_PRINCIPLE_IDS))
    .min(1)
    .describe("Product design QA principle IDs that make this issue block production delivery."),
  region: z.string().min(1),
  reason: z
    .string()
    .min(1)
    .describe("Why a professional design reviewer would block this surface from production delivery."),
  impact: z.string().min(1).describe("User-visible or product-quality impact if shipped as-is."),
  required_correction: z.string().min(1).describe("Concrete correction required before the product can ship."),
  source_refs: z.array(z.string().min(1)).default([]),
  evidence_refs: z.array(z.string().min(1)).default([]),
})

export const VisualQaCodeModuleReferenceSchema = z.object({
  entity: z
    .string()
    .min(1)
    .describe(
      "Concrete code module reference entity: file path, component, tool, service, route, schema, table, class, or function.",
    ),
  problem: z
    .string()
    .min(1)
    .describe("Observed problem tied to that entity. Generic project improvement text is not a valid problem."),
})

export const VisualQaUnresolvedCodeModuleProblemSchema = z.object({
  id: z.string().min(1),
  code_module_reference: VisualQaCodeModuleReferenceSchema,
  reason: z
    .string()
    .min(1)
    .describe("Evidence-backed reason Visual QA cannot safely repair this code module problem inside the current worktree."),
  blocker_ids: z.array(z.string().min(1)).min(1).describe("Production blocker IDs that expose this problem."),
  evidence_refs: z.array(z.string().min(1)).default([]),
})

export const VisualQaProblemDomRegionSchema = z.object({
  id: z.string().min(1),
  blocker_ids: z
    .array(z.string().min(1))
    .min(1)
    .describe("Production blocker IDs exposed by this rendered Document Object Model (DOM) region."),
  region: z.string().min(1).describe("Human-readable rendered region name."),
  route: z.string().min(1).optional().describe("Rendered app route where this DOM region was observed."),
  viewport: VisualQaViewportSchema.optional(),
  locator: z.string().min(1).describe("Stable selector or locator expression for the problematic rendered DOM node."),
  dom_path: z
    .string()
    .min(1)
    .optional()
    .describe("Concise path from the target node through relevant ancestors."),
  outer_html_excerpt: z.string().min(1).describe("Bounded HTML excerpt for the target DOM node."),
  ancestor_context: z
    .array(z.string().min(1))
    .default([])
    .describe("Nearby parent container summaries relevant to the visual defect."),
  sibling_context: z
    .array(z.string().min(1))
    .default([])
    .describe("Adjacent sibling summaries relevant to layout, spacing, or ordering."),
  text_content: z.string().optional(),
  role: z.string().optional(),
  accessible_name: z.string().optional(),
  bbox: VisualQaDomBoxSchema.optional().describe("Rendered CSS pixel box for the target DOM node."),
  computed_style: z
    .record(z.string(), z.string())
    .default({})
    .describe("Selected computed style values such as display, position, margin, padding, font, color, overflow, width, and height."),
  attributes: z
    .record(z.string(), z.string())
    .default({})
    .describe("Repair-relevant id, class, data, ARIA, and role attributes."),
  code_search_terms: z
    .array(z.string().min(1))
    .default([])
    .describe("Strings Build should grep first when mapping the DOM region to source code."),
  evidence_refs: z.array(z.string().min(1)).default([]),
  notes: z.string().min(1).describe("Concise repair guidance tied to these DOM facts."),
})

export const VisualQaRepairSchema = z.object({
  finding_ids: z.array(z.string().min(1)).default([]),
  files_changed: z.array(z.string().min(1)).default([]),
  reason: z.string().min(1),
  verification: z.string().min(1),
})

export const VisualQaEvidenceSchema = z.object({
  type: z.enum([
    "screenshot",
    "reference_comparison",
    "visual_diff",
    "text_diff",
    "console",
    "network",
    "command",
    "source_artifact",
    "other",
  ]),
  ref: z.string().min(1).describe("Path, URL, command id, or artifact ref."),
  viewport: VisualQaViewportSchema.optional(),
  state: z.string().optional(),
  note: z.string().min(1),
})

export const VisualQaReferenceParitySchema = z.object({
  required: z.boolean().default(false),
  required_regions: z.array(z.string().min(1)).default([]),
  reference_comparison_evidence_refs: z
    .array(z.string().min(1))
    .default([])
    .describe("Artifact IDs from persisted browser preview comparison evidence."),
  missing_regions: z.array(z.string().min(1)).default([]),
  blocker_ids: z
    .array(z.string().min(1))
    .default([])
    .describe("Production blocker IDs explaining missing comparison evidence when accepted=false."),
})

export const VisualQaCommandSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().min(1).optional(),
  passed: z.boolean(),
  detail: z.string().min(1),
})

export const VisualQaReportSchema = z.object({
  accepted: z.boolean(),
  summary: z.string().min(1),
  coverage: z.array(VisualQaCoverageSchema).default([]),
  findings: z.array(VisualQaFindingSchema).default([]),
  production_blockers: z.array(VisualQaProductionBlockerSchema).default([]),
  unresolved_code_module_problems: z.array(VisualQaUnresolvedCodeModuleProblemSchema).default([]),
  problem_dom_regions: z.array(VisualQaProblemDomRegionSchema).default([]),
  repairs: z.array(VisualQaRepairSchema).default([]),
  evidence: z.array(VisualQaEvidenceSchema).default([]),
  reference_parity: VisualQaReferenceParitySchema.default({
    required: false,
    required_regions: [],
    reference_comparison_evidence_refs: [],
    missing_regions: [],
    blocker_ids: [],
  }),
  commands: z.array(VisualQaCommandSchema).default([]),
  changed_files: z.array(z.string().min(1)).default([]),
  open_questions: z.array(z.string().min(1)).default([]),
  fact_check_items: FactCheckItemListSchema.default([]),
})

export const VisualQaAcceptanceSchema = z
  .object({
    submittedAccepted: z.boolean(),
    effectiveAccepted: z.boolean(),
    selfReportIssues: z.array(z.string()),
    blockingIssues: z.array(z.string()),
  })
  .strict()

export const VisualQaDecisionRecordSchema = z
  .object({
    report: VisualQaReportSchema,
    acceptance: VisualQaAcceptanceSchema,
  })
  .strict()

export type VisualQaReport = z.infer<typeof VisualQaReportSchema>
export type VisualQaAcceptance = z.infer<typeof VisualQaAcceptanceSchema>
export type VisualQaDecisionRecord = z.infer<typeof VisualQaDecisionRecordSchema>
