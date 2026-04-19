/**
 * Verification evidence signature — pure function.
 *
 * See specs/new-arch/09-verification-evidence.md §Signature.
 *
 * Signature is a SHA-256 hex digest covering the FAILED checks only, because
 * passed checks do not tell the rework loop anything about convergence. The
 * digest incorporates enough per-check detail (`exit_code`, `output_digest`)
 * that two runs which fail "in the same way" hash identically, while two runs
 * that fail for different reasons (different TS error code, different grep
 * miss) hash differently. This prevents the rework loop from fast-failing on
 * retries that ARE making progress but still land on a non-accept outcome.
 *
 * Deterministic across platforms as long as callers normalise output text
 * before computing `output_digest` (see sha256Hex + normaliseLines below).
 */
import { createHash } from "node:crypto"
import type {
  EngineEvaluationCheck,
  EngineEvaluationScope,
} from "@/engine/engine.sql"

/** 16-byte hex digest of the normalised text. 16 bytes (32 hex) is enough to
 *  distinguish stderr bodies in practice while keeping the evidence row small.
 *  Callers should pass the raw text; normalisation happens here. */
export function outputDigest(text: string | undefined | null): string {
  if (!text) return ""
  const normalised = normaliseLines(text)
  if (normalised.length === 0) return ""
  return createHash("sha256").update(normalised).digest("hex").slice(0, 32)
}

/** Strip CR, collapse trailing whitespace per line, drop trailing newlines —
 *  so Windows vs POSIX line endings and incidental trailing spaces don't
 *  produce distinct digests for semantically identical output. */
function normaliseLines(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n+$/, "")
}

/** Fields that participate in signature — ONE row per failed check, sorted so
 *  the result is deterministic regardless of checks[] order. */
interface SignaturePart {
  specID: string
  scorerKind: string
  mode: string
  trigger: string
  exitCode: string
  outputDigest: string
}

function toPart(check: EngineEvaluationCheck): SignaturePart | null {
  if (check.status !== "failed") return null
  return {
    specID: check.spec_id ?? check.name ?? "",
    scorerKind: check.scorer_kind ?? "unknown",
    mode: check.mode ?? "unknown",
    trigger: check.trigger ?? "unknown",
    exitCode: typeof check.exit_code === "number" ? String(check.exit_code) : "na",
    outputDigest: check.output_digest ?? outputDigest(check.evidence),
  }
}

function comparePart(a: SignaturePart, b: SignaturePart): number {
  if (a.specID !== b.specID) return a.specID < b.specID ? -1 : 1
  if (a.scorerKind !== b.scorerKind) return a.scorerKind < b.scorerKind ? -1 : 1
  if (a.mode !== b.mode) return a.mode < b.mode ? -1 : 1
  if (a.trigger !== b.trigger) return a.trigger < b.trigger ? -1 : 1
  if (a.exitCode !== b.exitCode) return a.exitCode < b.exitCode ? -1 : 1
  return a.outputDigest < b.outputDigest ? -1 : a.outputDigest > b.outputDigest ? 1 : 0
}

/** Compute the signature string for a checks[] array under a given scope.
 *
 *  Returns an empty string when there are no failed checks — the "all-pass"
 *  case does not participate in convergence detection (we never need to
 *  fast-fail a rework loop that is succeeding). Callers store that empty
 *  string verbatim; see the column default in `engine.sql.ts`. */
export function computeSignature(
  scope: EngineEvaluationScope,
  checks: readonly EngineEvaluationCheck[] | null | undefined,
): string {
  if (!checks || checks.length === 0) return ""
  const parts: SignaturePart[] = []
  for (const check of checks) {
    const p = toPart(check)
    if (p) parts.push(p)
  }
  if (parts.length === 0) return ""
  parts.sort(comparePart)
  const serialised =
    scope +
    "|" +
    parts
      .map(
        (p) =>
          `${p.specID}:${p.scorerKind}:${p.mode}:${p.trigger}:${p.exitCode}:${p.outputDigest}`,
      )
      .join(",")
  return createHash("sha256").update(serialised).digest("hex")
}

/** Convenience: two evidence rows converge when their signatures are equal
 *  AND both non-empty. Empty signature never converges with anything (treated
 *  as "historical / no failure to compare"). */
export function signaturesConverge(a: string, b: string): boolean {
  if (!a || !b) return false
  return a === b
}
