import { describe, expect, test } from "bun:test"
import { computeContractFieldChanges } from "../../src/orchestrator/tools"

/**
 * Spec build-missing-terminal-signal-restore-2026-05-07.md §5.3.
 *
 * `modify_goal` previously counted ANY field present in the `updates`
 * payload as changed (`contractChanged = contractFields.some(f => f in
 * setValues)`), which let the orchestrator LLM trigger phase=retry
 * decision_log feedback by resubmitting the SAME contract — observed in
 * tsk_e0033e523001flSn0onlHh4Urh as 4 modify_goal calls writing identical
 * "Goal contract changed... re-read acceptance_specs" entries while the
 * actual build failure was missing terminal tool call (an unrelated
 * concern that the generic feedback misled the next attempt about).
 *
 * `computeContractFieldChanges` deep-equality-checks each submitted field
 * against the persisted goal row; only true-differing fields appear in
 * the returned setValues, so a no-op modify_goal call writes nothing to
 * the database and does NOT create a phase=retry entry.
 */

describe("computeContractFieldChanges", () => {
  const baseGoal = {
    id: "gol_x",
    title: "Chat UI Components",
    objective: "Build the chat UI components.",
    acceptance_specs: ["MessageList renders streaming", "Sidebar collapses on mobile"],
    owned_paths: ["src/components"],
    depends_on: ["gol_a", "gol_b"],
    exports: ["MessageList"],
    imports: ["ChatMessage"],
    priority: "high",
    kind: "feature",
  }

  test("no fields submitted → empty setValues", () => {
    const result = computeContractFieldChanges({}, baseGoal)
    expect(result).toEqual({})
  })

  test("submitted values exactly match persisted values → empty setValues (no-op detection)", () => {
    const updates = {
      title: baseGoal.title,
      objective: baseGoal.objective,
      acceptance_specs: [...baseGoal.acceptance_specs],
      owned_paths: [...baseGoal.owned_paths],
      depends_on: [...baseGoal.depends_on],
      exports: [...baseGoal.exports],
      imports: [...baseGoal.imports],
      priority: baseGoal.priority,
      kind: baseGoal.kind,
    }
    const result = computeContractFieldChanges(updates, baseGoal)
    expect(result).toEqual({})
  })

  test("string field actually differs → only that field appears in setValues", () => {
    const result = computeContractFieldChanges(
      { title: "New chat title", objective: baseGoal.objective },
      baseGoal,
    )
    expect(result).toEqual({ title: "New chat title" })
  })

  test("array field actually differs (different element) → counted as changed", () => {
    const result = computeContractFieldChanges(
      { acceptance_specs: ["MessageList renders streaming", "Different second spec"] },
      baseGoal,
    )
    expect(result.acceptance_specs).toEqual(["MessageList renders streaming", "Different second spec"])
  })

  test("array field reordered → counted as changed (deep equality is order-sensitive — preserve operator intent)", () => {
    // The orchestrator LLM might intentionally reorder dependencies (e.g.
    // to express priority); honour that as a real change. The cost is
    // minor (a single retry-feedback entry) and matches "submit the
    // exact array I want persisted" semantics.
    const result = computeContractFieldChanges(
      { depends_on: ["gol_b", "gol_a"] },
      baseGoal,
    )
    expect(result.depends_on).toEqual(["gol_b", "gol_a"])
  })

  test("multiple fields, mix of changed and no-op → only changed fields appear", () => {
    const result = computeContractFieldChanges(
      {
        title: baseGoal.title, // no-op
        objective: "New objective sentence.",
        acceptance_specs: [...baseGoal.acceptance_specs], // no-op (same content)
        owned_paths: ["src/components", "src/hooks"], // changed (added entry)
      },
      baseGoal,
    )
    expect(result).toEqual({
      objective: "New objective sentence.",
      owned_paths: ["src/components", "src/hooks"],
    })
  })

  test("undefined fields are skipped (do not erase persisted values via empty diff)", () => {
    // Passing `title: undefined` is the same as not passing title at all —
    // the helper treats undefined as "field not submitted". This matches
    // modify_goal's pre-fix behaviour (line 2436: `if (updates.title !== undefined)`).
    const result = computeContractFieldChanges(
      { title: undefined, objective: "Different." },
      baseGoal,
    )
    expect(result).toEqual({ objective: "Different." })
  })

  test("unrecognised fields on updates are dropped (defence-in-depth — schema validates upstream)", () => {
    // GoalContractUpdateSchema strips unknown keys, but the helper
    // double-checks: only the canonical contract field list contributes
    // to setValues.
    const result = computeContractFieldChanges(
      { title: "Different", random_field: "ignored" } as Record<string, unknown>,
      baseGoal,
    )
    expect(result).toEqual({ title: "Different" })
    expect("random_field" in result).toBe(false)
  })

  test("array length change (added element) → counted as changed", () => {
    const result = computeContractFieldChanges(
      { exports: ["MessageList", "MessageBubble"] },
      baseGoal,
    )
    expect(result.exports).toEqual(["MessageList", "MessageBubble"])
  })

  test("array shrunk → counted as changed (intentional removal must propagate)", () => {
    const result = computeContractFieldChanges(
      { acceptance_specs: ["MessageList renders streaming"] },
      baseGoal,
    )
    expect(result.acceptance_specs).toEqual(["MessageList renders streaming"])
  })

  test("priority transition passed → empty setValues when value matches", () => {
    const result = computeContractFieldChanges({ priority: "high" }, baseGoal)
    expect(result).toEqual({})
  })

  test("priority transition counted when actually different", () => {
    const result = computeContractFieldChanges({ priority: "medium" }, baseGoal)
    expect(result.priority).toBe("medium")
  })
})
