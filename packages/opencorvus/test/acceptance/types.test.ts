import { describe, expect, test } from "bun:test"
import { AcceptanceSpecSchema, resolveTrigger, type AcceptanceSpec } from "../../src/acceptance/types"

const shellSpec = {
  id: "acc-shell",
  source_requirement_id: "REQ-1",
  goal_id: "G1",
  title: "Run deterministic check",
  scorers: [
    {
      type: "heuristic",
      name: "unit",
      spec: { kind: "shell", cmd: "bun test" },
    },
  ],
  severity: "essential",
}

describe("acceptance spec trigger contract", () => {
  test("rejects retired on_acceptance trigger", () => {
    expect(AcceptanceSpecSchema.safeParse({ ...shellSpec, trigger: "on_acceptance" }).success).toBe(false)
  })

  test("resolves explicit and default triggers", () => {
    const onIntegrity = AcceptanceSpecSchema.parse({ ...shellSpec, trigger: "on_integrity" }) as AcceptanceSpec
    const defaulted = AcceptanceSpecSchema.parse(shellSpec) as AcceptanceSpec

    expect(resolveTrigger(onIntegrity, onIntegrity.scorers[0]!)).toBe("on_integrity")
    expect(resolveTrigger(defaulted, defaulted.scorers[0]!)).toBe("on_goal")
  })
})

describe("acceptance prebuilt scorer config contract", () => {
  test("rejects hidden arbitrary config keys", () => {
    const spec = {
      ...shellSpec,
      scorers: [
        {
          type: "prebuilt",
          name: "contains",
          config: { arbitrary: true },
        },
      ],
    }

    expect(AcceptanceSpecSchema.safeParse(spec).success).toBe(false)
  })

  test("accepts closed visible config fields", () => {
    const spec = AcceptanceSpecSchema.parse({
      ...shellSpec,
      scorers: [
        {
          type: "prebuilt",
          name: "contains",
          config: { expected_text: "ready" },
        },
      ],
    }) as AcceptanceSpec

    const scorer = spec.scorers[0]
    expect(scorer.type).toBe("prebuilt")
    if (scorer.type === "prebuilt") {
      expect(scorer.config).toEqual({ expected_text: "ready" })
    }
  })
})
