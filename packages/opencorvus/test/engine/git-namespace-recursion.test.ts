import { describe, expect, test } from "bun:test"
import { EngineGit } from "../../src/engine/git"

describe("EngineGit namespace re-exports", () => {
  test("commitAcceptanceRound is not the same function as the namespace export (no shadowing recursion)", () => {
    // The arrow re-export `export const commitAcceptanceRound = (input) => commitAcceptanceRound(input)`
    // would resolve `commitAcceptanceRound` inside its body to the namespace member itself
    // (TypeScript namespace member shadows the outer function symbol), making every call
    // through `EngineGit.commitAcceptanceRound` recurse infinitely. This regression test
    // protects against re-introducing that pattern by toString'ing the wrapper and
    // asserting it does NOT call itself by the namespace-public name.
    const src = EngineGit.commitAcceptanceRound.toString()
    // The wrapper body must call the inner-scope alias (e.g. `_commitAcceptanceRound(...)`),
    // not a bare `commitAcceptanceRound(...)` that would resolve to itself via namespace shadowing.
    expect(/(?<![_A-Za-z0-9])commitAcceptanceRound\s*\(/.test(src)).toBe(false)
    expect(src).toMatch(/_commitAcceptanceRound\s*\(/)
  })

  test("evaluateAndApplyLKG re-export is also not self-recursive", () => {
    const src = EngineGit.evaluateAndApplyLKG.toString()
    expect(/(?<![_A-Za-z0-9])evaluateAndApplyLKG\s*\(/.test(src)).toBe(false)
    expect(src).toMatch(/_evaluateAndApplyLKG\s*\(/)
  })
})
