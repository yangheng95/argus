import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { PlannerService } from "@/planner/service"
import { PlannerAgent } from "@/planner/agent"

afterEach(() => {
  mock.restore()
})

const SPECS = {
  vague: {
    title: "优化性能",
    request: "优化性能",
    description: "Extremely vague — no context about what to optimize",
  },
  medium: {
    title: "Fix session list loading slow",
    request:
      "The session list page takes 3+ seconds to load when there are more than 100 sessions. " +
      "Optimize the query and add pagination.",
    description: "Moderately specified — has context but missing details",
  },
  detailed: {
    title: "Add dark mode toggle to overlay",
    request: `Add a dark/light mode toggle to the overlay panel.

Requirements:
- Toggle button in the titlebar next to the pin button
- Persist selection in localStorage
- Dark mode is the default (current theme)
- Light mode: white background, dark text, adjust all accent colors
- Transition: 200ms ease on background-color and color
- CSS custom properties for all theme colors

Files affected:
- packages/overlay/src/index.html (toggle button)
- packages/overlay/src/styles.css (CSS custom properties + light theme)
- packages/overlay/src/app.js (toggle logic + localStorage)`,
    description: "Fully specified with files, requirements, and implementation details",
  },
}

describe("PlannerService.initial — explicit failure", () => {
  test("vague spec surfaces planner failure", async () => {
    spyOn(PlannerAgent, "plan").mockRejectedValue(new Error("no llm"))
    await expect(
      PlannerService.initial({
        title: SPECS.vague.title,
        request: SPECS.vague.request,
      }),
    ).rejects.toThrow("planner agent failed")
  })

  test("detailed spec also surfaces planner failure", async () => {
    spyOn(PlannerAgent, "plan").mockRejectedValue(new Error("no llm"))
    await expect(
      PlannerService.initial({
        title: SPECS.detailed.title,
        request: SPECS.detailed.request,
      }),
    ).rejects.toThrow("planner agent failed")
  })
})

describe("PlannerService.initial — with user-provided goals", () => {
  test("user goals skip spec analysis", async () => {
    spyOn(PlannerAgent, "plan").mockResolvedValue({
      prd: "Expanded",
      summary: "Summary",
      goals: [
        {
          description: "Internal",
          criteria: "Internal",
          priority: "blocking",
          check_selector: ["build"],
        },
      ],
      subtasks: [
        { title: "Inspect", description: "Inspect", order: 1, block_id: "block-1" },
      ],
      risks: [],
    } as any)
    const plan = await PlannerService.initial({
      title: "Test task",
      request: "Some request",
      goals: [
        { description: "Goal A", criteria: "A passes", priority: "blocking" },
        { description: "Goal B", criteria: "B passes", priority: "advisory" },
      ],
      spec: {
        summary: "Test spec",
        content: "# Test spec",
        goals: [],
        assumptions: [],
        risks: [],
        module_blocks: [
          {
            id: "block-1",
            title: "Block 1",
            objective: "Implement block 1",
            owned_paths: ["src/"],
            spec_item_titles: [],
            dependencies: [],
            acceptance: ["build passes"],
            out_of_scope: [],
          },
        ],
      },
    })

    expect(plan.metadata.spec_analysis?.goals).toHaveLength(2)
    expect(plan.metadata.spec_analysis?.goals[0]?.description).toBe("Goal A")
    expect(plan.metadata.spec_analysis?.goals[1]?.description).toBe("Goal B")
    expect(plan.prompt).toContain("Goal A")
    expect(plan.prompt).toContain("Goal B")
    expect(plan.metadata.planner?.quality).toBe("compiled")
    expect(plan.metadata.strategy).toBe("initial")
  })
})
