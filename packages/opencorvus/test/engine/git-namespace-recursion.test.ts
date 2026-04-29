import { describe, expect, test } from "bun:test"
import { EngineGit } from "../../src/engine/git"

describe("EngineGit namespace re-exports", () => {
  test("commitDeliveryRound is not the same function as the namespace export (no shadowing recursion)", () => {
    // The arrow re-export `export const commitDeliveryRound = (input) => commitDeliveryRound(input)`
    // would resolve `commitDeliveryRound` inside its body to the namespace member itself
    // (TypeScript namespace member shadows the outer function symbol), making every call
    // through `EngineGit.commitDeliveryRound` recurse infinitely. This regression test
    // protects against re-introducing that pattern by toString'ing the wrapper and
    // asserting it does NOT call itself by the namespace-public name.
    const src = EngineGit.commitDeliveryRound.toString()
    // The wrapper body must call the inner-scope alias (e.g. `_commitDeliveryRound(...)`),
    // not a bare `commitDeliveryRound(...)` that would resolve to itself via namespace shadowing.
    expect(/(?<![_A-Za-z0-9])commitDeliveryRound\s*\(/.test(src)).toBe(false)
    expect(src).toMatch(/_commitDeliveryRound\s*\(/)
  })

  test("evaluateAndApplyLKG re-export is also not self-recursive", () => {
    const src = EngineGit.evaluateAndApplyLKG.toString()
    expect(/(?<![_A-Za-z0-9])evaluateAndApplyLKG\s*\(/.test(src)).toBe(false)
    expect(src).toMatch(/_evaluateAndApplyLKG\s*\(/)
  })
})
