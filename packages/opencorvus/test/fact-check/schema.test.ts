import { describe, expect, test } from "bun:test"
import {
  FactCheckItemSchema,
  FactCheckItemListSchema,
  FactCheckReportSchema,
  deriveFactCheckVerdict,
  validateFactCheckAgentReportSemantics,
} from "../../src/fact-check/schema"

describe("FactCheckItemSchema", () => {
  const baseItem = {
    claim: "React 19 introduced the use() hook for resource reading",
    confidence: "medium" as const,
    category: "library" as const,
    source: "model prior",
  }

  test("accepts a well-formed item", () => {
    const parsed = FactCheckItemSchema.safeParse(baseItem)
    expect(parsed.success).toBe(true)
  })

  test("rejects empty source (rule 7: no silent fallback)", () => {
    const parsed = FactCheckItemSchema.safeParse({ ...baseItem, source: "" })
    expect(parsed.success).toBe(false)
  })

  test("rejects too-short claim (must be ≥20 chars to be standalone)", () => {
    const parsed = FactCheckItemSchema.safeParse({ ...baseItem, claim: "too short" })
    expect(parsed.success).toBe(false)
  })

  test("rejects too-long claim (>280 chars)", () => {
    const parsed = FactCheckItemSchema.safeParse({ ...baseItem, claim: "x".repeat(281) })
    expect(parsed.success).toBe(false)
  })

  test("DOES NOT host-reject generic words (rule 20: no keyword regex)", () => {
    // 'tbd' / 'unknown' / 'n/a' must NOT trigger a schema-level rejection.
    // The fact-check agent classifies these at inspection time as
    // unresolved.why_unresolved="ambiguous" — that is the contract.
    const lazy = { ...baseItem, claim: "tbd this needs to be filled in later by someone" }
    const parsed = FactCheckItemSchema.safeParse(lazy)
    expect(parsed.success).toBe(true)
  })
})

describe("FactCheckItemListSchema", () => {
  test("stays a strict list primitive; terminal schemas opt into their own defaults", () => {
    // Passing `undefined` to the primitive list must fail; terminal report
    // schemas choose whether to wrap it with .default([]).
    expect(FactCheckItemListSchema.safeParse(undefined).success).toBe(false)
    expect(FactCheckItemListSchema.safeParse([]).success).toBe(true)
  })
})

describe("FactCheckReportSchema (anti-recursion)", () => {
  test("schema has no fact_check_items field — fact-check cannot register its own claims", () => {
    // The compiled zod object describes a shape; presence of an
    // unexpected key is rejected by strict mode.  Even without strict
    // mode, the type contract is enforced at usage sites.  We assert
    // the runtime shape directly.
    const shape = (FactCheckReportSchema as any).shape ?? (FactCheckReportSchema as any)._def?.shape?.()
    // zod v4 keeps the shape under _def
    const keys = shape ? Object.keys(shape) : []
    expect(keys).not.toContain("fact_check_items")
  })
})

describe("deriveFactCheckVerdict", () => {
  test("items_total=0 → clean (explicit boundary)", () => {
    expect(
      deriveFactCheckVerdict({ items_total: 0, items_inspected: 0, corrected: [], unresolved: [] }),
    ).toBe("clean")
  })

  test("blocking corrected → needs_orchestrator_action", () => {
    expect(
      deriveFactCheckVerdict({
        items_total: 3,
        items_inspected: 3,
        corrected: [
          {
            claim: "x",
            correction: "y",
            severity: "blocking",
            evidence: [{ kind: "web", pointer: "http://example.com", excerpt: "..." }],
            recommended_action: "modify_goal",
          },
        ],
        unresolved: [],
      }),
    ).toBe("needs_orchestrator_action")
  })

  test("blocking unresolved → needs_orchestrator_action", () => {
    expect(
      deriveFactCheckVerdict({
        items_total: 2,
        items_inspected: 1,
        corrected: [],
        unresolved: [{ claim: "x", why_unresolved: "out_of_scope", severity: "blocking" }],
      }),
    ).toBe("needs_orchestrator_action")
  })

  test("<50% inspected and no corrections → inconclusive", () => {
    expect(
      deriveFactCheckVerdict({ items_total: 10, items_inspected: 4, corrected: [], unresolved: [] }),
    ).toBe("inconclusive")
  })

  test("minor corrections only → minor_corrections", () => {
    expect(
      deriveFactCheckVerdict({
        items_total: 3,
        items_inspected: 3,
        corrected: [
          {
            claim: "x",
            correction: "y",
            severity: "minor",
            evidence: [{ kind: "web", pointer: "http://e.com", excerpt: "..." }],
            recommended_action: "accept_with_note",
          },
        ],
        unresolved: [],
      }),
    ).toBe("minor_corrections")
  })

  test("fully inspected, all verified → clean", () => {
    expect(
      deriveFactCheckVerdict({ items_total: 5, items_inspected: 5, corrected: [], unresolved: [] }),
    ).toBe("clean")
  })
})

describe("validateFactCheckAgentReportSemantics", () => {
  test("rejects overall_verdict that does not match the decision tree", () => {
    const semanticError = validateFactCheckAgentReportSemantics({
      scope: {
        target_session_id: "ses_target",
        target_agent: "build",
        target_message_id: "msg_target",
        target_message_content_hash: "hash",
        items_total: 1,
        items_inspected: 1,
      },
      verified: [],
      corrected: [
        {
          claim: "React 19 introduced the use() hook for resource reading",
          correction: "The claim needs a material correction.",
          severity: "material",
          evidence: [{ kind: "web", pointer: "https://example.com", excerpt: "evidence" }],
          recommended_action: "modify_goal",
        },
      ],
      unresolved: [],
      overall_verdict: "clean",
    })

    expect(semanticError).toContain('overall_verdict must be "needs_orchestrator_action"')
  })

  test("rejects hidden omissions between items_inspected and classified buckets", () => {
    const semanticError = validateFactCheckAgentReportSemantics({
      scope: {
        target_session_id: "ses_target",
        target_agent: "integrity",
        target_message_id: "msg_target",
        target_message_content_hash: "hash",
        items_total: 2,
        items_inspected: 2,
      },
      verified: [
        {
          claim: "The package manifest declares React as a dependency.",
          evidence: [{ kind: "code", pointer: "package.json", excerpt: "react" }],
        },
      ],
      corrected: [],
      unresolved: [],
      overall_verdict: "clean",
    })

    expect(semanticError).toContain("classified item count (1) must equal scope.items_inspected (2)")
  })
})
