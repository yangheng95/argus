import { describe, expect, test } from "bun:test"
import { PlannerService } from "@/planner/service"

// These test cases exercise the planner with various spec quality levels.
// When OPENCORVUS_PLANNER_LLM=0, it falls back to template-based planning.
// When an LLM is available, it runs spec analysis.

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

describe("PlannerService.initial — template fallback", () => {
  // Force template fallback
  const originalEnv = process.env.OPENCORVUS_PLANNER_LLM
  process.env.OPENCORVUS_PLANNER_LLM = "0"

  test("vague spec → single generic goal", async () => {
    const plan = await PlannerService.initial({
      title: SPECS.vague.title,
      request: SPECS.vague.request,
    })

    console.log("\n=== TEMPLATE: Vague Spec ===")
    console.log("Summary:", plan.summary)
    console.log("Goals:", plan.goals.length)
    for (const g of plan.goals) {
      console.log(`  - ${g.description}`)
      console.log(`    Criteria: ${g.criteria}`)
    }
    console.log("Prompt length:", plan.prompt.length, "chars")

    // Template produces exactly 1 generic goal
    expect(plan.goals).toHaveLength(1)
    expect(plan.goals[0].criteria).toBe(
      "The requested change is implemented and acceptance checks pass.",
    )
  })

  test("medium spec → still single generic goal", async () => {
    const plan = await PlannerService.initial({
      title: SPECS.medium.title,
      request: SPECS.medium.request,
    })

    console.log("\n=== TEMPLATE: Medium Spec ===")
    console.log("Summary:", plan.summary)
    console.log("Goals:", plan.goals.length)
    for (const g of plan.goals) {
      console.log(`  - ${g.description}`)
      console.log(`    Criteria: ${g.criteria}`)
    }

    // Template still produces 1 generic goal — doesn't analyze the spec
    expect(plan.goals).toHaveLength(1)
  })

  test("detailed spec → still single generic goal", async () => {
    const plan = await PlannerService.initial({
      title: SPECS.detailed.title,
      request: SPECS.detailed.request,
    })

    console.log("\n=== TEMPLATE: Detailed Spec ===")
    console.log("Summary:", plan.summary)
    console.log("Goals:", plan.goals.length)
    for (const g of plan.goals) {
      console.log(`  - ${g.description}`)
      console.log(`    Criteria: ${g.criteria}`)
    }

    // Template produces 1 generic goal even for a highly detailed spec
    expect(plan.goals).toHaveLength(1)
    // The prompt includes the request verbatim but no expansion
    expect(plan.prompt).toContain(SPECS.detailed.request.trim())
  })

  // Restore env
  if (originalEnv !== undefined) {
    process.env.OPENCORVUS_PLANNER_LLM = originalEnv
  } else {
    delete process.env.OPENCORVUS_PLANNER_LLM
  }
})

describe("PlannerService.initial — with user-provided goals", () => {
  test("user goals skip spec analysis", async () => {
    const plan = await PlannerService.initial({
      title: "Test task",
      request: "Some request",
      goals: [
        { description: "Goal A", criteria: "A passes", priority: "blocking" },
        { description: "Goal B", criteria: "B passes", priority: "advisory" },
      ],
    })

    expect(plan.goals).toHaveLength(2)
    expect(plan.goals[0].description).toBe("Goal A")
    expect(plan.goals[1].description).toBe("Goal B")
    // When explicit goals are provided, template plan is used (no agent)
    expect(plan.metadata.strategy).toBe("initial")
  })
})
