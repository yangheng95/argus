import z from "zod"

export const IntegrityVerdictSchema = z.enum(["pass", "concerns", "needs_correction"])
export type IntegrityVerdict = z.infer<typeof IntegrityVerdictSchema>

export const IntegrityReviewerPlanSchema = z
  .object({
    rationale: z.string().min(1),
    reviewers: z
      .array(
        z
          .object({
            reviewerID: z.string().min(1),
            title: z.string().min(1),
            focus: z.string().min(1),
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
    title: z.string().min(1),
    description: z.string().min(1),
    evidence: z.array(z.string().min(1)).min(1),
    targetIDs: z.array(z.string().min(1)).default([]),
    requirementIDs: z.array(z.string().min(1)).default([]),
    specIDs: z.array(z.string().min(1)).default([]),
    userRequestQuotes: z.array(z.string().min(1)).optional(),
    filePaths: z.array(z.string().min(1)).default([]),
    repair: z.string().min(1),
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
    description: z.string().min(1),
    evidence: z.array(z.string().min(1)).min(1),
    targetIDs: z.array(z.string().min(1)).default([]),
    filePaths: z.array(z.string().min(1)).default([]),
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
    findings: z.array(IntegrityFindingSchema).default([]),
    rounds: z.array(IntegrityReviewRoundSchema).default([]),
    requiredRepairs: z.array(IntegrityRequiredRepairSchema).default([]),
    unresolvedDisagreements: z.array(IntegrityUnresolvedDisagreementSchema).default([]),
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
