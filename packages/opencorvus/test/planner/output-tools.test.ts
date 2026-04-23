import { describe, expect, test } from "bun:test"
import { createPlannerOutputTools } from "../../src/planner/output-tools"

describe("planner output tools", () => {
  test("submit_plan finalizes a single structured plan", async () => {
    const kit = createPlannerOutputTools()
    const result = await kit.tools.submit_plan.execute({
      title: "API expansion plan",
      brief: "1. Update the router.\n2. Add handlers.\n3. Run the API checks.",
      file_actions: [
        { path: "src/router.ts", intent: "Register the new endpoint wiring." },
      ],
      verification_commands: [
        { command: "bun test", purpose: "Verify the API behavior still passes." },
      ],
    })

    expect(String(result)).toContain("PASS: plan submitted")
    expect(kit.getCollector().finalized).toBe(true)
    expect(kit.getCollector().plan).toEqual({
      title: "API expansion plan",
      brief: "1. Update the router.\n2. Add handlers.\n3. Run the API checks.",
      file_actions: [
        { path: "src/router.ts", intent: "Register the new endpoint wiring." },
      ],
      verification_commands: [
        { command: "bun test", purpose: "Verify the API behavior still passes." },
      ],
    })
  })

  test("submit_plan rejects a second successful submission", async () => {
    const kit = createPlannerOutputTools()
    await kit.tools.submit_plan.execute({
      title: "First plan",
      brief: "1. Do the first thing.",
      file_actions: [{ path: "src/first.ts", intent: "Make the first change." }],
      verification_commands: [],
    })

    const second = await kit.tools.submit_plan.execute({
      title: "Second plan",
      brief: "1. Try to overwrite the first thing.",
      file_actions: [{ path: "src/second.ts", intent: "Try to replace the first change." }],
      verification_commands: [],
    })

    expect(String(second)).toContain("already accepted")
    expect(kit.getCollector().errors).toHaveLength(1)
    expect(kit.getCollector().plan?.title).toBe("First plan")
  })
})