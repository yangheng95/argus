import { describe, test, expect } from "bun:test"
import { PlanFileSchema, GeneratedFileSchema } from "../../../src/mirror/ir/scaffold"
import { buildTiers } from "../../../src/mirror/shared/tier-graph"

describe("PlanFileSchema", () => {
  test("accepts minimal plan file", () => {
    expect(() =>
      PlanFileSchema.parse({
        file_info: "App entry",
        file_path: "src/App.tsx",
        notes: "",
      }),
    ).not.toThrow()
  })

  test("accepts rich plan file with contracts and images", () => {
    expect(() =>
      PlanFileSchema.parse({
        file_info: "Header component",
        file_path: "src/components/Header.tsx",
        notes: "Use flex row",
        images: ["ref/header-1.png"],
        contracts: {
          exports: ["Header"],
          types: "interface HeaderProps { title: string }",
          imports: { "./constants": ["COLORS"] },
        },
      }),
    ).not.toThrow()
  })

  test("rejects when file_path is absent", () => {
    expect(() =>
      PlanFileSchema.parse({ file_info: "x", notes: "" } as unknown as { file_path: string }),
    ).toThrow()
  })

  test("parsed PlanFile is compatible with tier-graph (structural)", () => {
    const plan = [
      PlanFileSchema.parse({
        file_info: "constants",
        file_path: "constants.ts",
        notes: "",
        contracts: { exports: ["COLORS"] },
      }),
      PlanFileSchema.parse({
        file_info: "App",
        file_path: "App.tsx",
        notes: "",
        contracts: { exports: ["App"], imports: { "./constants": ["COLORS"] } },
      }),
    ]
    const tiers = buildTiers(plan)
    expect(tiers).toHaveLength(2)
    expect(tiers[0][0].file_path).toBe("constants.ts")
    expect(tiers[1][0].file_path).toBe("App.tsx")
  })
})

describe("GeneratedFileSchema", () => {
  test("accepts path + code", () => {
    expect(() => GeneratedFileSchema.parse({ file_path: "a.tsx", code: "// hi" })).not.toThrow()
  })

  test("rejects missing code field", () => {
    expect(() => GeneratedFileSchema.parse({ file_path: "a.tsx" })).toThrow()
  })
})
