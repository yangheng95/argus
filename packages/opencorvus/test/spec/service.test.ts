import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { SpecAgent } from "../../src/spec/agent"
import { SpecService } from "../../src/spec/service"

const formulated = {
  summary: "Diary app spec",
  content: "# Scope\n\nImplement the diary requirements.",
  scope: "Implement the diary requirements.",
  requirements: [
    {
      id: "req_auth",
      title: "Authentication",
      description: "Users can register and sign in.",
      priority: "blocking" as const,
      acceptance: ["Register and login flows both succeed."],
      evidence_refs: ["src/routes/auth.ts"],
    },
    {
      id: "req_diary",
      title: "Diary CRUD",
      description: "Users can create, edit, list, and delete diaries.",
      priority: "blocking" as const,
      acceptance: ["CRUD flows work end-to-end."],
      evidence_refs: ["src/routes/diary.ts"],
    },
  ],
  assumptions: [],
  risks: [],
  evidence_sources: ["src/routes/auth.ts", "src/routes/diary.ts"],
  unresolved_questions: [],
  goals: [
    {
      description: "legacy compatibility goal",
      criteria: "should be ignored",
      priority: "blocking" as const,
    },
  ],
  spec_items: [
    {
      title: "legacy spec item",
      description: "should be ignored",
      priority: "blocking" as const,
      check_selector: ["build"],
    },
  ],
}

describe("spec.service", () => {
  afterEach(() => {
    mock.restore()
  })

  test("returns a requirements-first spec draft and ignores compatibility goals", async () => {
    spyOn(SpecAgent, "initial").mockResolvedValue(formulated as any)

    const spec = await SpecService.initial({
      title: "Implement diary app",
      request: "Implement diary auth and CRUD.",
    })

    expect(spec.requirements).toHaveLength(2)
    expect(spec.requirements.map((item) => item.id)).toEqual(["req_auth", "req_diary"])
    expect((spec as { goals?: unknown }).goals).toBeUndefined()
    expect((spec as { spec_items?: unknown }).spec_items).toBeUndefined()
  })

  test("rewrite remains requirements-first even when the raw agent output still contains legacy goal fields", async () => {
    spyOn(SpecAgent, "rewrite").mockResolvedValue(formulated as any)

    const spec = await SpecService.rewrite({
      title: "Implement diary app",
      request: "Replan the diary task.",
      rewriteContext: {
        previousSpec: formulated.content,
        failureAnalysis: {
          classification: "strategy",
          summary: "Previous attempt drifted from the requirements.",
          rootCause: "Planner followed compatibility goals instead of requirement contracts.",
          suggestedStrategy: "Reformulate from authoritative requirements only.",
          avoidApproaches: [],
        },
        previousGoalStatuses: [],
      },
    })

    expect(spec.summary).toBe("Diary app spec")
    expect(spec.requirements).toHaveLength(2)
    expect((spec as { goals?: unknown }).goals).toBeUndefined()
  })
})
