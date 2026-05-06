/**
 * Fix 2 (specs/architecture-review-rework-closure-2026-05-06.md, Layer 2)
 *
 * `resolvePostBuildReviewReworkGoalIDs` MUST NOT fall back to "the just-built
 * goal" when the review names no DB-resolvable target. The prior code path
 * dumped task-level architectural concerns onto whatever goal happened to be
 * in build (`fallbackGoalID = attachedGoalID`), producing the infinite V_n
 * rework loops that motivated this fix. orchestrator-core.txt:352-353
 * explicitly promises this behaviour to the prompt; the production code now
 * honours that promise.
 */
import { describe, expect, test } from "bun:test"
import { resolvePostBuildReviewReworkGoalIDs } from "../../src/orchestrator/tools"

describe("resolvePostBuildReviewReworkGoalIDs", () => {
  test("returns DB-resolvable goal IDs the review explicitly names", () => {
    const result = resolvePostBuildReviewReworkGoalIDs({
      review: {
        issueGoalIDs: ["gol_a", "gol_b"],
        correctionGoalIDs: ["gol_a", "gol_c"],
      },
      dbGoalIDs: new Set(["gol_a", "gol_b", "gol_c"]),
    })
    expect(result.sort()).toEqual(["gol_a", "gol_b", "gol_c"])
  })

  test("drops review-named IDs that do not exist in the DB", () => {
    // The integrity LLM accepts free-form strings on issues.goalIDs (see
    // integrity/agent.ts:323) and may emit logical names like
    // 'goal_session_mgmt' instead of the DB id `gol_…`. Propagating those
    // would crash startNewAttempt with "goal not found".
    const result = resolvePostBuildReviewReworkGoalIDs({
      review: {
        issueGoalIDs: ["goal_session_mgmt", "goal_layout"],
        correctionGoalIDs: [],
      },
      dbGoalIDs: new Set(["gol_dfb_1", "gol_dfb_2"]),
    })
    expect(result).toEqual([])
  })

  test("returns empty array when review names no IDs at all (no fallback to attachedGoalID)", () => {
    // This is the V3 production trace pattern: 16 issues, 0 corrections,
    // verdict=needs_correction. The pre-fix code returned [attachedGoalID]
    // here, which kicked off the V_n loop. Post-fix returns [] so the caller
    // treats the review as advisory and lets delivery proceed.
    const result = resolvePostBuildReviewReworkGoalIDs({
      review: {
        issueGoalIDs: [],
        correctionGoalIDs: [],
      },
      dbGoalIDs: new Set(["gol_a", "gol_b", "gol_c"]),
    })
    expect(result).toEqual([])
  })

  test("ignores empty / falsy IDs in the review payload", () => {
    const result = resolvePostBuildReviewReworkGoalIDs({
      review: {
        issueGoalIDs: ["", "gol_a"],
        correctionGoalIDs: ["", ""],
      },
      dbGoalIDs: new Set(["gol_a"]),
    })
    expect(result).toEqual(["gol_a"])
  })

  test("dedupes IDs that appear in both issueGoalIDs and correctionGoalIDs", () => {
    const result = resolvePostBuildReviewReworkGoalIDs({
      review: {
        issueGoalIDs: ["gol_a", "gol_a"],
        correctionGoalIDs: ["gol_a"],
      },
      dbGoalIDs: new Set(["gol_a"]),
    })
    expect(result).toEqual(["gol_a"])
  })
})
