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

export const VisualQaFollowUpTaskSchema = z.object({
  title: z.string().min(1).describe("Concise title for the inheriting follow-up task."),
  request: z
    .string()
    .min(1)
    .describe("Complete, self-contained request for the next task round that addresses the unrepairable blockers."),
  reason: z
    .string()
    .min(1)
    .describe("Evidence-backed reason Visual QA cannot safely repair these blockers inside the current worktree."),
  priority: z.enum(["critical", "high", "normal", "low"]).default("high"),
  blocker_ids: z.array(z.string().min(1)).min(1).describe("Production blocker IDs this follow-up task must address."),
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
    .describe("Artifact IDs from browser_preview_compare_regions reference-comparison evidence."),
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
  follow_up_task: VisualQaFollowUpTaskSchema.nullable().default(null),
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

export type VisualQaReport = z.infer<typeof VisualQaReportSchema>
