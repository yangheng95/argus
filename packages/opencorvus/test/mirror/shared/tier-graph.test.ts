import { describe, test, expect } from "bun:test"
import {
  buildTiers,
  buildDependencyGraph,
  type TierPlanFile,
} from "../../../src/mirror/shared/tier-graph"

function plan(...entries: Array<[string, string[]?]>): TierPlanFile[] {
  return entries.map(([file_path, imports]) => ({
    file_path,
    contracts: { imports: Object.fromEntries((imports ?? []).map((k) => [k, []])) },
  }))
}

function planWithoutContracts(...paths: string[]): TierPlanFile[] {
  return paths.map((file_path) => ({ file_path }))
}

describe("buildTiers — contract-based", () => {
  test("empty plan → empty tiers", () => {
    expect(buildTiers([])).toEqual([])
  })

  test("single file with no deps → one tier with one file", () => {
    const p = plan(["App.tsx"])
    const tiers = buildTiers(p)
    expect(tiers).toHaveLength(1)
    expect(tiers[0]).toHaveLength(1)
  })

  test("topologically orders contract imports", () => {
    const p = plan(
      ["App.tsx", ["./Header.tsx", "./Footer.tsx"]],
      ["Header.tsx", ["./constants.ts"]],
      ["Footer.tsx", ["./constants.ts"]],
      ["constants.ts"],
    )
    const tiers = buildTiers(p)
    expect(tiers).toHaveLength(3)
    expect(tiers[0].map((f) => f.file_path)).toEqual(["constants.ts"])
    expect(tiers[1].map((f) => f.file_path).sort()).toEqual(["Footer.tsx", "Header.tsx"])
    expect(tiers[2].map((f) => f.file_path)).toEqual(["App.tsx"])
  })

  test("circular deps throw instead of emitting an unsafe tier", () => {
    const p = plan(
      ["a.ts", ["./b"]],
      ["b.ts", ["./a"]],
    )
    expect(() => buildTiers(p)).toThrow(/circular or unsatisfied imports/)
  })

  test("resolves ./ prefix and extension-less imports", () => {
    const p = plan(
      ["src/App.tsx", ["./utils"]],
      ["src/utils.ts"],
    )
    const tiers = buildTiers(p)
    expect(tiers[0].map((f) => f.file_path)).toEqual(["src/utils.ts"])
    expect(tiers[1].map((f) => f.file_path)).toEqual(["src/App.tsx"])
  })

  test("resolves index-file imports", () => {
    const p = plan(
      ["App.tsx", ["./lib"]],
      ["lib/index.ts"],
    )
    const tiers = buildTiers(p)
    expect(tiers[0].map((f) => f.file_path)).toEqual(["lib/index.ts"])
  })
})

describe("buildTiers — no implicit contracts", () => {
  test("missing contracts.imports throws instead of guessing from filenames", () => {
    const p = planWithoutContracts("App.tsx", "constants.ts")
    expect(() => buildTiers(p)).toThrow(/without explicit contracts\.imports/)
  })
})

describe("buildDependencyGraph", () => {
  test("every file has an entry, even with empty imports", () => {
    const p = plan(["A.ts"], ["B.ts"])
    const g = buildDependencyGraph(p)
    expect(g.size).toBe(2)
    expect(g.get("A.ts")!.size).toBe(0)
    expect(g.get("B.ts")!.size).toBe(0)
  })

  test("self-import is not recorded", () => {
    const p = plan(["A.ts", ["./A"]])
    const g = buildDependencyGraph(p)
    expect(g.get("A.ts")!.has("A.ts")).toBe(false)
  })
})
