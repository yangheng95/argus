import z from "zod"
import {
  IntegrityFindingSchema,
  IntegrityRequiredRepairSchema,
  IntegrityReviewRoundSchema,
  IntegrityReviewerReportSchema,
  IntegrityUnresolvedDisagreementSchema,
  IntegrityVerdictSchema,
} from "./team-schema"
import {
  assertIntegrityFindingFingerprint,
  canonicalIntegritySymptom,
  defaultIntegrityVerify,
  integrityFindingFingerprint,
  isIntegrityFindingFingerprint,
  stableList,
} from "./finding-manifest"

export const IntegrityAttemptPhaseSchema = z.enum(["pre_build", "post_build"])

const NonEmptyStringSchema = z.string().min(1)
const OptionalStringArraySchema = z.array(NonEmptyStringSchema).default([])
const IntegrityAttemptFingerprintSchema = z.string().refine(isIntegrityFindingFingerprint, {
  message: "fingerprint must match if_[a-f0-9]{16}",
})

const IntegrityAttemptReviewerSummarySchema = z
  .object({
    reviewerID: NonEmptyStringSchema,
    scope: NonEmptyStringSchema,
    verdict: IntegrityVerdictSchema.optional(),
  })
  .strict()

const IntegrityAttemptReviewerInputSchema = z.union([
  IntegrityReviewerReportSchema,
  IntegrityAttemptReviewerSummarySchema,
])

const IntegrityAttemptFindingSummaryInputSchema = z
  .object({
    id: NonEmptyStringSchema,
    severity: z.enum(["blocking", "advisory"]),
    verdictImpact: IntegrityVerdictSchema.optional(),
    fingerprint: IntegrityAttemptFingerprintSchema.optional(),
    canonicalSymptom: NonEmptyStringSchema.optional(),
    title: NonEmptyStringSchema,
    description: NonEmptyStringSchema,
    evidence: OptionalStringArraySchema,
    targetIDs: OptionalStringArraySchema,
    requirementIDs: OptionalStringArraySchema,
    specIDs: OptionalStringArraySchema,
    filePaths: OptionalStringArraySchema,
    affectedSymbols: OptionalStringArraySchema,
    repair: NonEmptyStringSchema,
    verify: OptionalStringArraySchema,
    sourceFindingIDs: OptionalStringArraySchema,
    priorAttemptRefs: OptionalStringArraySchema,
    reviewers: OptionalStringArraySchema,
  })
  .strict()

const IntegrityAttemptFindingInputSchema = z.union([IntegrityFindingSchema, IntegrityAttemptFindingSummaryInputSchema])

const IntegrityAttemptRequiredRepairSummaryInputSchema = z
  .object({
    id: NonEmptyStringSchema,
    fingerprint: IntegrityAttemptFingerprintSchema.optional(),
    severity: z.enum(["blocking", "advisory"]).default("blocking"),
    title: NonEmptyStringSchema.optional(),
    canonicalSymptom: NonEmptyStringSchema.optional(),
    description: NonEmptyStringSchema,
    evidence: OptionalStringArraySchema,
    targetIDs: OptionalStringArraySchema,
    requirementIDs: OptionalStringArraySchema,
    specIDs: OptionalStringArraySchema,
    filePaths: OptionalStringArraySchema,
    affectedSymbols: OptionalStringArraySchema,
    repair: NonEmptyStringSchema.optional(),
    verify: OptionalStringArraySchema,
    sourceFindingIDs: OptionalStringArraySchema,
    priorAttemptRefs: OptionalStringArraySchema,
  })
  .strict()

const IntegrityAttemptRequiredRepairInputSchema = z.union([
  IntegrityRequiredRepairSchema,
  IntegrityAttemptRequiredRepairSummaryInputSchema,
])

const IntegrityAttemptUnresolvedDisagreementSummarySchema = z
  .object({
    id: NonEmptyStringSchema,
    description: NonEmptyStringSchema,
  })
  .strict()

const IntegrityAttemptUnresolvedDisagreementInputSchema = z.union([
  IntegrityUnresolvedDisagreementSchema,
  IntegrityAttemptUnresolvedDisagreementSummarySchema,
])

export const IntegrityAttemptReviewerPayloadSchema = IntegrityAttemptReviewerSummarySchema

export const IntegrityAttemptFindingPayloadSchema = z
  .object({
    id: NonEmptyStringSchema,
    severity: z.enum(["blocking", "advisory"]),
    verdictImpact: IntegrityVerdictSchema.optional(),
    fingerprint: IntegrityAttemptFingerprintSchema,
    canonicalSymptom: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    description: NonEmptyStringSchema,
    evidence: z.array(NonEmptyStringSchema),
    targetIDs: z.array(NonEmptyStringSchema),
    requirementIDs: z.array(NonEmptyStringSchema),
    specIDs: z.array(NonEmptyStringSchema),
    filePaths: z.array(NonEmptyStringSchema),
    affectedSymbols: z.array(NonEmptyStringSchema),
    repair: NonEmptyStringSchema,
    verify: z.array(NonEmptyStringSchema),
    sourceFindingIDs: z.array(NonEmptyStringSchema),
    priorAttemptRefs: z.array(NonEmptyStringSchema),
    reviewers: z.array(NonEmptyStringSchema),
  })
  .strict()

export const IntegrityAttemptRequiredRepairPayloadSchema = z
  .object({
    id: NonEmptyStringSchema,
    fingerprint: IntegrityAttemptFingerprintSchema,
    severity: z.enum(["blocking", "advisory"]),
    canonicalSymptom: NonEmptyStringSchema,
    description: NonEmptyStringSchema,
    repair: NonEmptyStringSchema,
    verify: z.array(NonEmptyStringSchema),
    filePaths: z.array(NonEmptyStringSchema),
    requirementIDs: z.array(NonEmptyStringSchema),
    specIDs: z.array(NonEmptyStringSchema),
    sourceFindingIDs: z.array(NonEmptyStringSchema),
    priorAttemptRefs: z.array(NonEmptyStringSchema),
  })
  .strict()

export const IntegrityAttemptUnresolvedDisagreementPayloadSchema =
  IntegrityAttemptUnresolvedDisagreementSummarySchema

export const IntegrityAttemptPayloadSchema = z
  .object({
    spec_snapshot_id: NonEmptyStringSchema,
    session_id: NonEmptyStringSchema,
    verdict: IntegrityVerdictSchema,
    phase: IntegrityAttemptPhaseSchema,
    attempts: z.number().int().positive(),
    reviewers: z.array(IntegrityAttemptReviewerPayloadSchema),
    findings_count: z.number().int().nonnegative(),
    required_repairs_count: z.number().int().nonnegative(),
    unresolved_disagreements_count: z.number().int().nonnegative(),
    reason: z.string().min(1).nullable(),
    team_report_markdown: z.string().min(1).nullable(),
    findings: z.array(IntegrityAttemptFindingPayloadSchema),
    rounds: z.array(IntegrityReviewRoundSchema),
    required_repairs: z.array(IntegrityAttemptRequiredRepairPayloadSchema),
    unresolved_disagreements: z.array(IntegrityAttemptUnresolvedDisagreementPayloadSchema),
    time_completed: z.number().int().nonnegative(),
  })
  .strict()

export type IntegrityAttemptPayload = z.infer<typeof IntegrityAttemptPayloadSchema>
export type IntegrityAttemptFindingPayload = z.infer<typeof IntegrityAttemptFindingPayloadSchema>
export type IntegrityAttemptRequiredRepairPayload = z.infer<typeof IntegrityAttemptRequiredRepairPayloadSchema>

export type IntegrityAttemptPayloadInput = {
  specSnapshotID: string
  sessionID: string
  verdict: z.infer<typeof IntegrityVerdictSchema>
  phase: z.infer<typeof IntegrityAttemptPhaseSchema>
  attempts: number
  reviewers?: unknown[]
  findingsCount?: number
  requiredRepairsCount?: number
  unresolvedDisagreementsCount?: number
  reason?: string
  teamReportMarkdown?: string
  findings?: unknown[]
  rounds?: unknown[]
  requiredRepairs?: unknown[]
  unresolvedDisagreements?: unknown[]
  timeCompleted: number
}

export function createIntegrityAttemptPayload(input: IntegrityAttemptPayloadInput): IntegrityAttemptPayload {
  const findings = parseArrayItems({
    value: input.findings ?? [],
    itemName: "integrity attempt finding",
    parse: normalizeIntegrityAttemptFinding,
  })
  const requiredRepairs = parseArrayItems({
    value: input.requiredRepairs ?? [],
    itemName: "integrity attempt required repair",
    parse: (item, index) => normalizeIntegrityAttemptRequiredRepair(item, index, findings),
  })
  const payload = {
    spec_snapshot_id: input.specSnapshotID,
    session_id: input.sessionID,
    verdict: input.verdict,
    phase: input.phase,
    attempts: input.attempts,
    reviewers: parseArrayItems({
      value: input.reviewers ?? [],
      itemName: "integrity attempt reviewer",
      parse: normalizeIntegrityAttemptReviewer,
    }),
    findings_count: input.findingsCount ?? findings.length,
    required_repairs_count: input.requiredRepairsCount ?? requiredRepairs.length,
    unresolved_disagreements_count: input.unresolvedDisagreementsCount ?? (input.unresolvedDisagreements ?? []).length,
    reason: input.reason ?? null,
    team_report_markdown: input.teamReportMarkdown ?? null,
    findings,
    rounds: parseArrayItems({
      value: input.rounds ?? [],
      itemName: "integrity attempt round",
      parse: (item, index) => parseWithSchema(IntegrityReviewRoundSchema, item, `integrity attempt round ${index + 1}`),
    }),
    required_repairs: requiredRepairs,
    unresolved_disagreements: parseArrayItems({
      value: input.unresolvedDisagreements ?? [],
      itemName: "integrity attempt unresolved disagreement",
      parse: normalizeIntegrityAttemptUnresolvedDisagreement,
    }),
    time_completed: input.timeCompleted,
  }
  return parseWithSchema(IntegrityAttemptPayloadSchema, payload, "integrity attempt payload")
}

export function parseIntegrityAttemptPayload(value: unknown, context: string): IntegrityAttemptPayload {
  return parseWithSchema(IntegrityAttemptPayloadSchema, value, context)
}

function normalizeIntegrityAttemptReviewer(item: unknown, index: number): IntegrityAttemptPayload["reviewers"][number] {
  const reviewer = parseWithSchema(IntegrityAttemptReviewerInputSchema, item, `integrity attempt reviewer ${index + 1}`)
  return parseWithSchema(
    IntegrityAttemptReviewerPayloadSchema,
    {
      reviewerID: reviewer.reviewerID,
      scope: reviewer.scope,
      verdict: reviewer.verdict,
    },
    `integrity attempt reviewer ${index + 1} payload`,
  )
}

function normalizeIntegrityAttemptFinding(item: unknown, index: number): IntegrityAttemptFindingPayload {
  const finding = parseWithSchema(IntegrityAttemptFindingInputSchema, item, `integrity attempt finding ${index + 1}`)
  const canonicalSymptom = finding.canonicalSymptom ?? canonicalIntegritySymptom(finding)
  const computedFingerprint = integrityFindingFingerprint({ ...finding, canonicalSymptom })
  if (finding.fingerprint) {
    assertIntegrityFindingFingerprint(finding.fingerprint, `integrity attempt finding ${finding.id}.fingerprint`)
    if (finding.fingerprint !== computedFingerprint) {
      throw new Error(`integrity attempt finding ${finding.id}.fingerprint does not match the host-computed fingerprint`)
    }
  }
  const withSymptom = { ...finding, canonicalSymptom }
  return parseWithSchema(
    IntegrityAttemptFindingPayloadSchema,
    {
      id: finding.id,
      severity: finding.severity,
      verdictImpact: finding.verdictImpact,
      fingerprint: computedFingerprint,
      canonicalSymptom,
      title: finding.title,
      description: finding.description,
      evidence: stableList(finding.evidence),
      targetIDs: stableList(finding.targetIDs),
      requirementIDs: stableList(finding.requirementIDs),
      specIDs: stableList(finding.specIDs),
      filePaths: stableList(finding.filePaths),
      affectedSymbols: stableList(finding.affectedSymbols),
      repair: finding.repair,
      verify: stableList(finding.verify).length > 0 ? stableList(finding.verify) : defaultIntegrityVerify(withSymptom),
      sourceFindingIDs: stableList(finding.sourceFindingIDs),
      priorAttemptRefs: stableList(finding.priorAttemptRefs),
      reviewers: stableList(finding.reviewers),
    },
    `integrity attempt finding ${finding.id} payload`,
  )
}

function normalizeIntegrityAttemptRequiredRepair(
  item: unknown,
  index: number,
  findings: IntegrityAttemptFindingPayload[],
): IntegrityAttemptRequiredRepairPayload {
  const repair = parseWithSchema(
    IntegrityAttemptRequiredRepairInputSchema,
    item,
    `integrity attempt required repair ${index + 1}`,
  )
  const linkedFinding = findings.find(
    (finding) =>
      stableList(repair.sourceFindingIDs).includes(finding.id) ||
      repair.id === finding.id ||
      repair.id === `repair-${finding.id}` ||
      repair.id === `repair_${finding.id}`,
  )
  const repairText = repair.repair ?? linkedFinding?.repair ?? repair.description
  const canonicalSymptom =
    repair.canonicalSymptom ??
    linkedFinding?.canonicalSymptom ??
    canonicalIntegritySymptom({ ...repair, repair: repairText })
  const withSymptom = { ...repair, repair: repairText, canonicalSymptom }
  const computedFingerprint = linkedFinding?.fingerprint ?? integrityFindingFingerprint(withSymptom)
  if (repair.fingerprint) {
    assertIntegrityFindingFingerprint(repair.fingerprint, `integrity attempt required repair ${repair.id}.fingerprint`)
    if (repair.fingerprint !== computedFingerprint) {
      throw new Error(`integrity attempt required repair ${repair.id}.fingerprint does not match the host-computed fingerprint`)
    }
  }
  return parseWithSchema(
    IntegrityAttemptRequiredRepairPayloadSchema,
    {
      id: repair.id,
      fingerprint: computedFingerprint,
      severity: repair.severity ?? linkedFinding?.severity ?? "blocking",
      canonicalSymptom,
      description: repair.description,
      repair: repairText,
      verify: stableList(repair.verify).length > 0 ? stableList(repair.verify) : defaultIntegrityVerify(withSymptom),
      filePaths: stableList([...(repair.filePaths ?? []), ...(linkedFinding?.filePaths ?? [])]),
      requirementIDs: stableList([...(repair.requirementIDs ?? []), ...(linkedFinding?.requirementIDs ?? [])]),
      specIDs: stableList([...(repair.specIDs ?? []), ...(linkedFinding?.specIDs ?? [])]),
      sourceFindingIDs: stableList([...(repair.sourceFindingIDs ?? []), ...(linkedFinding ? [linkedFinding.id] : [])]),
      priorAttemptRefs: stableList(repair.priorAttemptRefs),
    },
    `integrity attempt required repair ${repair.id} payload`,
  )
}

function normalizeIntegrityAttemptUnresolvedDisagreement(
  item: unknown,
  index: number,
): IntegrityAttemptPayload["unresolved_disagreements"][number] {
  const disagreement = parseWithSchema(
    IntegrityAttemptUnresolvedDisagreementInputSchema,
    item,
    `integrity attempt unresolved disagreement ${index + 1}`,
  )
  return parseWithSchema(
    IntegrityAttemptUnresolvedDisagreementPayloadSchema,
    {
      id: disagreement.id,
      description: disagreement.description,
    },
    `integrity attempt unresolved disagreement ${index + 1} payload`,
  )
}

function parseArrayItems<T>(input: {
  value: unknown
  itemName: string
  parse: (item: unknown, index: number) => T
}): T[] {
  if (!Array.isArray(input.value)) {
    throw new Error(`${input.itemName}s must be an array`)
  }
  return input.value.map((item, index) => input.parse(item, index))
}

function parseWithSchema<T extends z.ZodTypeAny>(schema: T, value: unknown, context: string): z.infer<T> {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const path = issue?.path.length ? ` at ${issue.path.join(".")}` : ""
    const detail = issue ? `: ${issue.message}` : ""
    throw new Error(`${context} is invalid${path}${detail}`)
  }
  return parsed.data
}
