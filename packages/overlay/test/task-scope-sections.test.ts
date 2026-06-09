import { expect, test } from "bun:test"
import { taskScopeSectionVisibility, taskScopeWorkflowSectionID } from "../src/utils/task-scope-sections"

test("task-scope workflow sections are visible while their steps are active", () => {
  const visibility = taskScopeSectionVisibility({
    workflow: {
      steps: [
        { id: "requirements", status: "running" },
        { id: "architect", status: "pending" },
        { id: "frontend_research", status: "pending" },
      ],
    },
    requirements: [],
    architect: null,
  })

  expect(visibility.frontendResearch).toBe(false)
  expect(visibility.requirements).toBe(true)
  expect(visibility.architect).toBe(false)
})

test("task-scope workflow sections remain visible once data exists", () => {
  const visibility = taskScopeSectionVisibility({
    workflow: {
      steps: [
        { id: "requirements", status: "completed" },
        { id: "architect", status: "pending" },
        { id: "frontend_research", status: "completed" },
      ],
    },
    requirements: [{ id: "req_1" }],
    architect: { contractCount: 3 },
  })

  expect(visibility.frontendResearch).toBe(true)
  expect(visibility.requirements).toBe(true)
  expect(visibility.architect).toBe(true)
})

test("task-scope workflow sections stay hidden before backend progress exists", () => {
  const visibility = taskScopeSectionVisibility({
    workflow: {
      steps: [
        { id: "requirements", status: "pending" },
        { id: "architect", status: "pending" },
        { id: "frontend_research", status: "pending" },
      ],
    },
    requirements: [],
    architect: null,
  })

  expect(visibility).toEqual({ frontendResearch: false, requirements: false, architect: false })
})

test("frontend research section is visible when the workflow step fails before an agent card exists", () => {
  const visibility = taskScopeSectionVisibility({
    workflow: {
      steps: [
        { id: "frontend_research", status: "failed" },
        { id: "requirements", status: "pending" },
        { id: "architect", status: "pending" },
      ],
    },
    requirements: [],
    architect: null,
  })

  expect(visibility.frontendResearch).toBe(true)
  expect(taskScopeWorkflowSectionID("frontend_research")).toBe("frontendResearch")
  expect(taskScopeWorkflowSectionID("frontend_design")).toBe("frontendResearch")
})
