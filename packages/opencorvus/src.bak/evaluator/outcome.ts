/**
 * EvaluationOutcome builders — reduce repetitive object construction
 * across evaluator check functions.
 *
 * Every check function returns the same shape:
 *   { outcome, summary, checks: [{name, status, evidence}], artifacts: [{kind, label, payload}] }
 *
 * These builders eliminate the 15+ manual constructions of this shape.
 */

type Outcome = "passed" | "failed" | "skipped"

interface EvaluationOutcome {
  outcome: Outcome
  summary: string
  checks: Array<{ name: string; status: Outcome; evidence: string }>
  artifacts: Array<{ kind: "log" | "report" | "image"; label: string; payload: Record<string, unknown> }>
}

/** Build a "passed" outcome for a named check. */
export function passed(name: string, summary: string, evidence: string, payload: Record<string, unknown>): EvaluationOutcome {
  return {
    outcome: "passed",
    summary,
    checks: [{ name, status: "passed", evidence }],
    artifacts: [{ kind: "report", label: `evaluation:${name}`, payload }],
  }
}

/** Build a hard "failed" outcome (check unavailable, model error, etc.). */
export function failed(name: string, summary: string, evidence: string, payload: Record<string, unknown>): EvaluationOutcome {
  return {
    outcome: "failed",
    summary,
    checks: [{ name, status: "failed", evidence }],
    artifacts: [{ kind: "report", label: `evaluation:${name}`, payload }],
  }
}

/**
 * Build a mode-dependent outcome:
 *   - strict → "failed"
 *   - soft   → "skipped"
 */
export function softOrStrict(input: {
  mode: "soft" | "strict"
  name: string
  summary: string
  evidence: string
  payload: Record<string, unknown>
}): EvaluationOutcome {
  const status: Outcome = input.mode === "strict" ? "failed" : "skipped"
  return {
    outcome: status,
    summary: input.summary,
    checks: [{ name: input.name, status, evidence: input.evidence }],
    artifacts: [{ kind: "report", label: `evaluation:${input.name}`, payload: input.payload }],
  }
}

/** Empty outcome for disabled/unconfigured optional checks. */
export function empty(): EvaluationOutcome {
  return {
    outcome: "passed",
    summary: "",
    checks: [],
    artifacts: [],
  }
}
