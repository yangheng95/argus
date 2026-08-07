// ABI means Application Binary Interface. URL means Uniform Resource Locator.
// SHA-256 means Secure Hash Algorithm 256-bit.

import { createHash } from "node:crypto"
import {
  tool,
  type TaskArtifactRef,
  type ToolContext,
} from "@opencorvus-ai/plugin"

export const PRISM_SOURCE_OBSERVATION_SCHEMA_VERSION = 1
export const PRISM_SOURCE_OBSERVATION_TYPE = "prism/source-observation"
export const PRISM_AINVEST_WORKFLOW_ID = "mirror-prism-ainvest"

const nonempty = tool.schema.string().trim().min(1)
const productID = tool.schema
  .string()
  .regex(
    /^[a-z](?:[a-z0-9-]{0,62}[a-z0-9])?$/,
    "identity must be 1-64 lowercase kebab-case characters without a trailing hyphen",
  )
const distinctStrings = tool.schema
  .array(nonempty)
  .refine((values) => new Set(values).size === values.length, "values must be unique")
const nonemptyDistinctStrings = distinctStrings.min(1)

const TargetSchema = tool.schema
  .object({
    product_id: productID,
    product_name: nonempty,
    source_url: tool.schema.string().trim().url(),
  })
  .strict()

const ObservationQuestionSchema = tool.schema
  .object({
    id: productID,
    subject: nonempty,
    question: nonempty,
    evidence_requirements: nonemptyDistinctStrings,
  })
  .strict()

const DecisionMatrixRowSchema = tool.schema
  .object({
    product_id: productID,
    question_id: productID,
    evidence_status: tool.schema.enum(["evidenced", "missing"]),
    source_url: tool.schema.string().trim().url().nullable(),
    access_context: nonempty.nullable(),
    observed_fact: nonempty.nullable(),
    inference: nonempty.nullable(),
    disposition: tool.schema.enum(["adopt", "defer", "reject"]),
  })
  .strict()
  .superRefine((row, context) => {
    if (row.evidence_status === "evidenced" && (!row.source_url || !row.observed_fact)) {
      context.addIssue({
        code: "custom",
        message: "evidenced rows require source_url and observed_fact",
      })
    }
    if (
      row.evidence_status === "missing" &&
      (row.source_url !== null || row.access_context !== null || row.observed_fact !== null || row.inference !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "missing rows require null source_url, access_context, observed_fact, and inference",
      })
    }
  })

export const PrismSourceObservationPayloadSchema = tool.schema
  .object({
    workflow_id: tool.schema.literal(PRISM_AINVEST_WORKFLOW_ID),
    targets: tool.schema
      .array(TargetSchema)
      .min(1)
      .superRefine((targets, context) => {
        for (const [field, values] of [
          ["product_id", targets.map((target) => target.product_id)],
          ["product_name", targets.map((target) => target.product_name)],
          ["source_url", targets.map((target) => target.source_url)],
        ] as const) {
          if (new Set(values).size !== values.length) {
            context.addIssue({ code: "custom", message: `target ${field} values must be unique` })
          }
        }
      }),
    page_scope: nonemptyDistinctStrings,
    observation_questions: tool.schema
      .array(ObservationQuestionSchema)
      .min(1)
      .refine(
        (questions) => new Set(questions.map((question) => question.id)).size === questions.length,
        "observation question IDs must be unique",
      ),
    limitations: distinctStrings,
    decision_matrix: tool.schema
      .array(DecisionMatrixRowSchema)
      .min(1)
      .refine(
        (rows) => new Set(rows.map((row) => observationKey(row))).size === rows.length,
        "decision matrix product and question pairs must be unique",
      ),
    unresolved_evidence_gaps: tool.schema
      .array(
        tool.schema
          .object({
            product_id: productID,
            question_id: productID,
            reason: nonempty,
          })
          .strict(),
      )
      .refine(
        (rows) => new Set(rows.map((row) => observationKey(row))).size === rows.length,
        "unresolved evidence gap product and question pairs must be unique",
      ),
    resource_roles: tool.schema
      .array(
        tool.schema
          .object({
            role: nonempty,
            resource_index: tool.schema.number().int().nonnegative(),
          })
          .strict(),
      )
      .refine((rows) => new Set(rows.map((row) => row.role)).size === rows.length, "resource roles must be unique"),
  })
  .strict()

export type PrismSourceObservationPayload = tool.schema.infer<typeof PrismSourceObservationPayloadSchema>

function observationKey(input: { product_id: string; question_id: string }): string {
  return `${input.product_id}\u0000${input.question_id}`
}

function displayKeys(keys: readonly string[]): string {
  return [...keys].sort().map((key) => key.replace("\u0000", "/")).join(",") || "-"
}

function exactSetViolations(input: {
  subject: string
  expected: ReadonlySet<string>
  actual: ReadonlySet<string>
}): string[] {
  const missing = [...input.expected].filter((key) => !input.actual.has(key))
  const unknown = [...input.actual].filter((key) => !input.expected.has(key))
  return missing.length === 0 && unknown.length === 0
    ? []
    : [`${input.subject}: missing=${displayKeys(missing)}; unknown=${displayKeys(unknown)}`]
}

export function prismSourceObservationViolations(input: {
  research: PrismSourceObservationPayload
  resourceCount: number
}): string[] {
  const expectedRows = new Set(
    input.research.targets.flatMap((target) =>
      input.research.observation_questions.map((question) =>
        observationKey({ product_id: target.product_id, question_id: question.id }),
      ),
    ),
  )
  const actualRows = new Set(input.research.decision_matrix.map(observationKey))
  const violations = exactSetViolations({
    subject: "Prism source observation target-question coverage mismatch",
    expected: expectedRows,
    actual: actualRows,
  })

  const missingRows = new Set(
    input.research.decision_matrix
      .filter((row) => row.evidence_status === "missing")
      .map(observationKey),
  )
  const gapRows = new Set(input.research.unresolved_evidence_gaps.map(observationKey))
  violations.push(
    ...exactSetViolations({
      subject: "Prism unresolved evidence gap mismatch",
      expected: missingRows,
      actual: gapRows,
    }),
  )

  const expectedIndexes = Array.from({ length: input.resourceCount }, (_, index) => index)
  const actualIndexes = input.research.resource_roles
    .map((row) => row.resource_index)
    .sort((left, right) => left - right)
  if (JSON.stringify(actualIndexes) !== JSON.stringify(expectedIndexes)) {
    violations.push(
      `Prism source observation resource_roles must reference every resource index exactly once; expected ${expectedIndexes.join(",") || "none"}, received ${actualIndexes.join(",") || "none"}`,
    )
  }
  return violations
}

export async function readPrismResourceViolations(
  context: ToolContext,
  refs: readonly TaskArtifactRef[],
): Promise<string[]> {
  const violations: string[] = []
  if (new Set(refs.map((ref) => JSON.stringify(ref.snapshot))).size > 1) {
    violations.push("Prism source observation resources must come from one immutable snapshot")
  }
  if (new Set(refs.map((ref) => `${ref.tree}\u0000${ref.path}`)).size !== refs.length) {
    violations.push("Prism source observation resource refs must be distinct")
  }
  const reads = await Promise.allSettled(
    refs.map(async (ref) => {
      const bytes = await context.host.taskArtifacts.read(ref)
      if (bytes.byteLength !== ref.bytes) {
        throw new Error("byte count does not match the immutable resource ref")
      }
      if (createHash("sha256").update(bytes).digest("hex") !== ref.sha256) {
        throw new Error("SHA-256 does not match the immutable resource ref")
      }
    }),
  )
  violations.push(
    ...reads.flatMap((result, index) =>
      result.status === "rejected"
        ? [
            `resources[${index}]: ${
              result.reason instanceof Error ? result.reason.message : String(result.reason)
            }`,
          ]
        : [],
    ),
  )
  return violations
}
