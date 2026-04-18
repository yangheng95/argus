import { describe, test, expect } from "bun:test"
import {
  buildTiers,
  buildDependencyGraph,
  buildHeuristicDependencyGraph,
  type TierPlanFile,
} from "../../../src/mirror/shared/tier-graph"

function plan(...entries: Array<[string, string[]?]>): TierPlanFile[] {
  return entries.map(([file_path, imports]) => ({
    file_path,
    contracts: imports ? { imports: Object.fromEntries(imports.map((k) => [k, []])) } : undefined,
  }))
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

  test("circular deps → remainder goes into a single terminal tier", () => {
    const p = plan(
      ["a.ts", ["./b"]],
      ["b.ts", ["./a"]],
    )
    const tiers = buildTiers(p)
    expect(tiers).toHaveLength(1)
    expect(tiers[0]).toHaveLength(2)
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

describe("buildTiers — heuristic fallback (no contracts)", () => {
  test("<= 2 files → single tier even without contracts", () => {
    const p = plan(["App.tsx"], ["main.tsx"])
    expect(buildTiers(p)).toHaveLength(1)
  })

  test("separates foundation files into tier 0", () => {
    const p = plan(
      ["App.tsx"],
      ["Header.tsx"],
      ["constants.ts"],
      ["utils.ts"],
      ["types.ts"],
    )
    const tiers = buildTiers(p)
    expect(tiers.length).toBeGreaterThanOrEqual(2)
    const tier0Names = tiers[0].map((f) => f.file_path).sort()
    expect(tier0Names).toEqual(["constants.ts", "types.ts", "utils.ts"])
  })

  test("chunks non-foundation files in ~4 per tier", () => {
    const p = plan(
      ["A.tsx"],
      ["B.tsx"],
      ["C.tsx"],
      ["D.tsx"],
      ["E.tsx"],
      ["F.tsx"],
      ["G.tsx"],
      ["H.tsx"],
      ["I.tsx"],
    )
    const tiers = buildTiers(p)
    // 9 components → 3 tiers of 3 each (9 / ceil(9/4)=3 → tier size 3)
    for (const tier of tiers) {
      expect(tier.length).toBeLessThanOrEqual(4)
    }
    const total = tiers.reduce((n, t) => n + t.length, 0)
    expect(total).toBe(9)
  })
})

describe("buildDependencyGraph", () => {
  test("every file has an entry, even without imports", () => {
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

describe("buildHeuristicDependencyGraph", () => {
  test("non-foundation files depend on every foundation file", () => {
    const p = plan(
      ["constants.ts"],
      ["types.ts"],
      ["App.tsx"],
      ["Header.tsx"],
    )
    const g = buildHeuristicDependencyGraph(p)
    expect(g.get("App.tsx")).toEqual(new Set(["constants.ts", "types.ts"]))
    expect(g.get("Header.tsx")).toEqual(new Set(["constants.ts", "types.ts"]))
    expect(g.get("constants.ts")!.size).toBe(0)
  })

  test("chains non-foundation files in groups of 4", () => {
    const p = plan(
      ["A.tsx"], ["B.tsx"], ["C.tsx"], ["D.tsx"],
      ["E.tsx"], ["F.tsx"],
    )
    const g = buildHeuristicDependencyGraph(p)
    // E depends on A (position 4 - 4 = 0 → A); F → B
    expect(g.get("E.tsx")!.has("A.tsx")).toBe(true)
    expect(g.get("F.tsx")!.has("B.tsx")).toBe(true)
    expect(g.get("A.tsx")!.size).toBe(0)
  })
})
