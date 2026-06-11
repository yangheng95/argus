import z from "zod"
import { FactCheckItemListSchema } from "@/fact-check/schema"

export const IntegrityVerdictSchema = z.enum(["pass", "concerns", "needs_correction"])
export type IntegrityVerdict = z.infer<typeof IntegrityVerdictSchema>

export const IntegrityCoverageStatusValues = ["covered", "missing", "inconclusive"] as const
export const IntegrityCoverageStatusSchema = z.enum(IntegrityCoverageStatusValues)
export type IntegrityCoverageStatus = z.infer<typeof IntegrityCoverageStatusSchema>

export const IntegrityReviewerPlanSchema = z
  .object({
    rationale: z.string().min(1),
    taskProfile: z
      .object({
        categories: z.array(z.string().min(1)).default([]),
        requestCriticalPromises: z.array(z.string().min(1)).default([]),
        changedSurfaces: z.array(z.string().min(1)).default([]),
        availableEvidenceSurfaces: z.array(z.string().min(1)).default([]),
      })
      .strict()
      .optional(),
    riskHypotheses: z
      .array(
        z
          .object({
            id: z.string().min(1),
            title: z.string().min(1),
            whyRelevantToRequest: z.string().min(1),
            evidenceNeeded: z.array(z.string().min(1)).min(1),
            suggestedReviewerID: z.string().min(1).optional(),
          })
          .strict(),
      )
      .default([]),
    coveragePlan: z.array(z.string().min(1)).default([]),
    reviewers: z
      .array(
        z
          .object({
            reviewerID: z.string().min(1),
            title: z.string().min(1),
            focus: z.string().min(1),
            riskHypothesisIDs: z.array(z.string().min(1)).default([]),
            drilldownPlan: z.array(z.string().min(1)).default([]),
            adversarialQuestions: z.array(z.string().min(1)).min(1),
          })
          .strict(),
      )
      .min(2)
      .max(6),
  })
  .strict()

export type IntegrityReviewerPlan = z.infer<typeof IntegrityReviewerPlanSchema>
export type IntegrityReviewerScope = IntegrityReviewerPlan["reviewers"][number]

export const IntegrityFindingSchema = z
  .object({
    id: z.string().min(1),
    severity: z.enum(["blocking", "advisory"]),
    verdictImpact: IntegrityVerdictSchema,
    fingerprint: z.string().min(1).optional(),
    canonicalSymptom: z.string().min(1).optional(),
    title: z.string().min(1),
    description: z.string().min(1),
    evidence: z.array(z.string().min(1)).min(1),
    targetIDs: z.array(z.string().min(1)).default([]),
    requirementIDs: z.array(z.string().min(1)).default([]),
    specIDs: z.array(z.string().min(1)).default([]),
    userRequestQuotes: z.array(z.string().min(1)).optional(),
    filePaths: z.array(z.string().min(1)).default([]),
    affectedSymbols: z.array(z.string().min(1)).default([]),
    repair: z.string().min(1),
    verify: z.array(z.string().min(1)).default([]),
    sourceFindingIDs: z.array(z.string().min(1)).default([]),
    priorAttemptRefs: z.array(z.string().min(1)).default([]),
    reviewers: z.array(z.string().min(1)).default([]),
    consensus: z.enum(["agreed", "disputed", "unresolved"]).default("agreed"),
  })
  .strict()

export type IntegrityFinding = z.infer<typeof IntegrityFindingSchema>

export const IntegrityReviewerReportSchema = z
  .object({
    reviewerID: z.string().min(1),
    scope: z.string().min(1),
    verdict: IntegrityVerdictSchema,
    summary: z.string().min(1),
    investigationPlan: z
      .object({
        requestPromise: z
          .string()
          .min(1)
          .describe("Concrete original user, REQ, or acceptance-spec promise this reviewer is falsifying."),
        hypothesis: z.string().min(1).describe("Concrete way the scoped promise could fail."),
        evidencePlan: z
          .array(z.string().min(1))
          .min(1)
          .describe("Evidence this reviewer planned to inspect before passing or filing a finding."),
        passCriteria: z
          .array(z.string().min(1))
          .min(1)
          .describe("Concrete evidence threshold for pass versus finding."),
      })
      .strict()
      .describe("Required falsification plan for this reviewer report."),
    drilldowns: z
      .array(
        z
          .object({
            kind: z.string().min(1).describe("Evidence tool or inspection category."),
            target: z
              .string()
              .min(1)
              .describe("Concrete file, directory, command, evidence section, or artifact inspected."),
            purpose: z.string().min(1).describe("Why this evidence was inspected for the reviewer scope."),
            result: z
              .string()
              .min(1)
              .describe("What the inspection showed. Do not add finding fields such as affectedSymbols here."),
          })
          .strict(),
      )
      .default([]),
    coverage: z
      .array(
        z
          .object({
            requirementID: z
              .string()
              .min(1)
              .describe("Singular coverage anchor such as REQ-1. Do not use requirementIDs here.")
              .optional(),
            specID: z
              .string()
              .min(1)
              .describe("Singular coverage anchor for one acceptance spec id. Do not use specIDs here.")
              .optional(),
            userRequestQuote: z
              .string()
              .min(1)
              .describe("Singular literal user-request quote. Do not use userRequestQuotes here.")
              .optional(),
            status: IntegrityCoverageStatusSchema.describe(
              "Coverage status only. Do not use verdict values such as pass, concerns, or needs_correction here.",
            ),
            evidence: z.string().min(1),
          })
          .strict()
          .refine(
            (value) => Boolean(value.requirementID || value.specID || value.userRequestQuote),
            "coverage rows require requirementID, specID, or userRequestQuote",
          ),
      )
      .default([]),
    evidence: z.array(z.string().min(1)).default([]),
    findings: z.array(IntegrityFindingSchema).default([]),
    openQuestions: z.array(z.string().min(1)).default([]),
  })
  .strict()

export type IntegrityReviewerReport = z.infer<typeof IntegrityReviewerReportSchema>

export const IntegrityReviewRoundSchema = z
  .object({
    roundID: z.string().min(1),
    prompt: z.string().min(1),
    reviewerIDs: z.array(z.string().min(1)).min(1),
    outcome: z.string().min(1),
  })
  .strict()

export type IntegrityReviewRound = z.infer<typeof IntegrityReviewRoundSchema>

export const IntegrityRequiredRepairSchema = z
  .object({
    id: z.string().min(1),
    fingerprint: z.string().min(1).optional(),
    severity: z.enum(["blocking", "advisory"]).default("blocking"),
    title: z.string().min(1).optional(),
    canonicalSymptom: z.string().min(1).optional(),
    description: z.string().min(1),
    evidence: z.array(z.string().min(1)).min(1),
    targetIDs: z.array(z.string().min(1)).default([]),
    requirementIDs: z.array(z.string().min(1)).default([]),
    specIDs: z.array(z.string().min(1)).default([]),
    filePaths: z.array(z.string().min(1)).default([]),
    affectedSymbols: z.array(z.string().min(1)).default([]),
    repair: z.string().min(1).optional(),
    verify: z.array(z.string().min(1)).default([]),
    sourceFindingIDs: z.array(z.string().min(1)).default([]),
    priorAttemptRefs: z.array(z.string().min(1)).default([]),
  })
  .strict()

export type IntegrityRequiredRepair = z.infer<typeof IntegrityRequiredRepairSchema>

export const IntegrityUnresolvedDisagreementSchema = z
  .object({
    id: z.string().min(1),
    description: z.string().min(1),
    reviewerIDs: z.array(z.string().min(1)).min(2),
    consequence: z.string().min(1),
  })
  .strict()

export type IntegrityUnresolvedDisagreement = z.infer<typeof IntegrityUnresolvedDisagreementSchema>

export const IntegrityTeamReportSchema = z
  .object({
    verdict: IntegrityVerdictSchema,
    summary: z.string().min(1),
    teamReportMarkdown: z.string().min(1),
    reviewers: z.array(IntegrityReviewerReportSchema).min(2),
    coverageAudit: z
      .array(
        z
          .object({
            promise: z.string().min(1),
            reviewerIDs: z.array(z.string().min(1)).default([]),
            status: IntegrityCoverageStatusSchema.describe(
              "Coverage status only. Do not use verdict values such as pass, concerns, or needs_correction here.",
            ),
            notes: z.string().min(1),
          })
          .strict(),
      )
      .default([]),
    uninspectedRisks: z
      .array(
        z
          .object({
            risk: z.string().min(1),
            reason: z.string().min(1),
            action: z.enum(["block", "re-review", "advisory"]),
          })
          .strict(),
      )
      .default([]),
    findings: z.array(IntegrityFindingSchema).default([]),
    rounds: z.array(IntegrityReviewRoundSchema).default([]),
    requiredRepairs: z.array(IntegrityRequiredRepairSchema).default([]),
    unresolvedDisagreements: z.array(IntegrityUnresolvedDisagreementSchema).default([]),
    // Optional fact-check registration. CONSENSUS phase only —
    // `submit_integrity_review_plan` and
    // `submit_reviewer_report` schemas (the plan/reviewer stages) intentionally
    // do NOT carry fact_check_items; only the supervisor's consensus output
    // is downstream-consumed as IntegrityTeamReport.
    fact_check_items: FactCheckItemListSchema.default([]).describe(
      "Every factual claim (API behaviour, library version, third-party protocol, number, path, history) the integrity team has NOT verified via tool calls in this session. Empty when only review judgments or in-session-verified statements.",
    ),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasBlocking = value.findings.some((finding) => finding.severity === "blocking")
    const hasUnresolved = value.unresolvedDisagreements.length > 0
    if (hasBlocking && value.verdict !== "needs_correction") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "blocking findings require needs_correction verdict",
      })
    }
    if (value.verdict === "pass" && (hasBlocking || hasUnresolved || value.requiredRepairs.length > 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "pass verdict cannot contain blocking findings, required repairs, or unresolved disagreements",
      })
    }
    if (value.verdict === "needs_correction" && value.requiredRepairs.length === 0 && !hasBlocking) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "needs_correction requires at least one blocking finding or required repair",
      })
    }
  })

export type IntegrityTeamReport = z.infer<typeof IntegrityTeamReportSchema>

export const IntegrityReviewCompletedPayloadSchema = IntegrityTeamReportSchema.safeExtend({
  taskID: z.string().min(1),
  sessionID: z.string().min(1),
  attempts: z.number().int().positive(),
}).strict()

export type IntegrityReviewCompletedPayload = z.infer<typeof IntegrityReviewCompletedPayloadSchema>
