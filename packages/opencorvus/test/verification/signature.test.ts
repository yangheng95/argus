import { describe, expect, test } from "bun:test"
import {
  computeSignature,
  outputDigest,
  signaturesConverge,
} from "@/verification/signature"
import type { EngineEvaluationCheck } from "@/engine/engine.sql"

const strictFail = (over: Partial<EngineEvaluationCheck> = {}): EngineEvaluationCheck => ({
  name: "acc-build",
  spec_id: "acc-build",
  scorer_kind: "heuristic_shell",
  mode: "strict",
  severity: "essential",
  trigger: "on_goal",
  status: "failed",
  exit_code: 1,
  evidence: "tsc error TS2345",
  output_digest: outputDigest("tsc error TS2345"),
  ...over,
})

describe("computeSignature", () => {
  test("empty checks → empty signature", () => {
    expect(computeSignature("goal_run", [])).toBe("")
    expect(computeSignature("delivery", null as any)).toBe("")
    expect(computeSignature("goal_run", undefined as any)).toBe("")
  })

  test("only-passed checks → empty signature (no failure to converge on)", () => {
    const passed: EngineEvaluationCheck = {
      name: "acc-typecheck",
      status: "passed",
    }
    expect(computeSignature("goal_run", [passed])).toBe("")
  })

  test("identical failed checks → identical signatures across call order", () => {
    const a = strictFail({ spec_id: "spec-a" })
    const b = strictFail({ spec_id: "spec-b" })
    const sig1 = computeSignature("goal_run", [a, b])
    const sig2 = computeSignature("goal_run", [b, a])
    expect(sig1).toBe(sig2)
    expect(sig1.length).toBe(64) // sha256 hex
  })

  test("different scope → different signatures for the same checks", () => {
    const c = strictFail()
    expect(computeSignature("goal_run", [c])).not.toBe(
      computeSignature("delivery", [c]),
    )
  })

  test("exit_code change → different signatures (root cause moved)", () => {
    const a = strictFail({ exit_code: 1 })
    const b = strictFail({ exit_code: 2 })
    expect(computeSignature("goal_run", [a])).not.toBe(
      computeSignature("goal_run", [b]),
    )
  })

  test("evidence text change with same exit_code → different signatures via output_digest", () => {
    const a = strictFail({
      evidence: "tsc error TS2345",
      output_digest: outputDigest("tsc error TS2345"),
    })
    const b = strictFail({
      evidence: "tsc error TS2741",
      output_digest: outputDigest("tsc error TS2741"),
    })
    expect(computeSignature("goal_run", [a])).not.toBe(
      computeSignature("goal_run", [b]),
    )
  })

  test("skipped / passed checks do not contribute", () => {
    const failed = strictFail({ spec_id: "spec-failed" })
    const passed: EngineEvaluationCheck = {
      name: "acc-x",
      spec_id: "spec-passed",
      status: "passed",
    }
    const skipped: EngineEvaluationCheck = {
      name: "acc-y",
      spec_id: "spec-skipped",
      status: "skipped",
    }
    expect(computeSignature("goal_run", [failed])).toBe(
      computeSignature("goal_run", [failed, passed, skipped]),
    )
  })

  test("missing optional fields fall back to stable placeholders", () => {
    const minimal: EngineEvaluationCheck = {
      name: "acc-mini",
      status: "failed",
    }
    const sig1 = computeSignature("goal_run", [minimal])
    const sig2 = computeSignature("goal_run", [minimal])
    expect(sig1).not.toBe("")
    expect(sig1).toBe(sig2) // stable across repeated calls with same input
  })

  test("two failing checks with different names are both reflected", () => {
    const a: EngineEvaluationCheck = { name: "acc-a", spec_id: "spec-a", status: "failed" }
    const b: EngineEvaluationCheck = { name: "acc-b", spec_id: "spec-b", status: "failed" }
    const sigA = computeSignature("goal_run", [a])
    const sigAB = computeSignature("goal_run", [a, b])
    expect(sigA).not.toBe(sigAB)
  })
})

describe("outputDigest", () => {
  test("empty / undefined → empty string", () => {
    expect(outputDigest("")).toBe("")
    expect(outputDigest(undefined)).toBe("")
    expect(outputDigest("   \n\n")).toBe("")
  })

  test("windows vs posix line endings produce identical digest", () => {
    const a = "line 1\nline 2\nline 3"
    const b = "line 1\r\nline 2\r\nline 3"
    expect(outputDigest(a)).toBe(outputDigest(b))
  })

  test("trailing whitespace per line normalised", () => {
    const a = "line 1\nline 2"
    const b = "line 1   \nline 2\t\t"
    expect(outputDigest(a)).toBe(outputDigest(b))
  })

  test("32 hex chars (16 bytes)", () => {
    const d = outputDigest("some output")
    expect(d.length).toBe(32)
    expect(d).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe("signaturesConverge", () => {
  test("empty signatures never converge", () => {
    expect(signaturesConverge("", "")).toBe(false)
    expect(signaturesConverge("", "abc")).toBe(false)
    expect(signaturesConverge("abc", "")).toBe(false)
  })

  test("equal non-empty → converge", () => {
    expect(signaturesConverge("abc123", "abc123")).toBe(true)
  })

  test("unequal → do not converge", () => {
    expect(signaturesConverge("abc", "def")).toBe(false)
  })
})
