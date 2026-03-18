import { describe, expect, test } from "bun:test"
import { HeadlessGoalService } from "../../src/goal/service"

const SPEC = {
  summary: "Diary workflow",
  content: "# Scope\n\nImplement setup, auth, and timeline requirements.",
  scope: "Implement setup, auth, and timeline requirements.",
  requirements: [
    {
      id: "req_setup",
      title: "Project setup",
      description: "Configure the project entry and dependencies.",
      priority: "blocking" as const,
      acceptance: ["Project dependencies install cleanly."],
      evidence_refs: ["package.json"],
    },
    {
      id: "req_auth",
      title: "Authentication",
      description: "Users can register and sign in.",
      priority: "blocking" as const,
      acceptance: ["Register and login flows both succeed."],
      evidence_refs: ["src/routes/auth.ts"],
    },
    {
      id: "req_timeline",
      title: "Timeline view",
      description: "Users can browse timeline entries.",
      priority: "blocking" as const,
      acceptance: ["Timeline entries render in order."],
      evidence_refs: ["src/routes/timeline.ts"],
    },
  ],
  assumptions: [],
  risks: [],
  evidence_sources: ["package.json", "src/routes/auth.ts", "src/routes/timeline.ts"],
  unresolved_questions: [],
} as const

describe("goal.service", () => {
  test("compiles the full deterministic goal graph on the initial run", async () => {
    const draft = await HeadlessGoalService.initial({
      title: "Diary workflow",
      request: "Implement setup, auth, and timeline requirements.",
      spec: SPEC as any,
    })

    expect(draft.goals.map((goal) => goal.id)).toEqual(["goal_setup", "goal_auth", "goal_timeline"])
    expect(draft.goals[1]?.depends_on_goal_ids).toEqual(["goal_setup"])
    expect(draft.goals[2]?.depends_on_goal_ids).toEqual(["goal_auth"])
  })

  test("recompile scopes the goal graph to unresolved goals and their downstream dependents", async () => {
    const draft = await HeadlessGoalService.recompile({
      title: "Diary workflow",
      request: "Replan the remaining work.",
      spec: SPEC as any,
      goalHints: [
        {
          description: "Authentication",
          criteria: "Register and login flows both succeed.",
          priority: "blocking",
          metadata: {
            source_goal_id: "goal_auth",
          },
        },
      ],
      replanContext: {
        previousSummary: "Previous attempt partially completed setup.",
        failureAnalysis: {
          classification: "implementation",
          summary: "Authentication delivery failed acceptance.",
          rootCause: "The auth routes were incomplete.",
          suggestedStrategy: "Focus on the remaining auth and timeline work only.",
          avoidApproaches: [],
        },
        previousGoalStatuses: [
          {
            description: "Project setup",
            status: "passed",
            evidence: "setup landed",
          },
          {
            description: "Authentication",
            status: "failed",
            evidence: "auth failed",
          },
          {
            description: "Timeline view",
            status: "pending",
            evidence: "not started",
          },
        ],
      },
    })

    expect(draft.summary).toContain("scoped goals recompiled")
    expect(draft.goals.map((goal) => goal.id)).toEqual(["goal_auth", "goal_timeline"])
    expect(draft.goals[0]?.depends_on_goal_ids).toEqual([])
    expect(draft.goals[1]?.depends_on_goal_ids).toEqual(["goal_auth"])
  })

  test("preserves explicit requirement check selectors when compiling goals", async () => {
    const draft = await HeadlessGoalService.initial({
      title: "Diary workflow",
      request: "Compile the goal graph from explicit QA selectors.",
      spec: {
        ...SPEC,
        requirements: [
          {
            id: "req_build_only",
            title: "Build gate",
            description: "The project builds cleanly.",
            priority: "blocking" as const,
            acceptance: ["Build passes."],
            evidence_refs: ["package.json"],
            metadata: {
              check_selector: ["build"],
            },
          },
          {
            id: "req_test_only",
            title: "Test gate",
            description: "The tests pass cleanly.",
            priority: "advisory" as const,
            acceptance: ["Tests pass."],
            evidence_refs: ["src/routes/auth.ts"],
            metadata: {
              check_selector: ["test"],
            },
          },
        ],
      } as any,
    })

    expect(draft.goals.find((goal) => goal.title === "Build gate")?.qa_profile.rule_selectors).toEqual(["build"])
    expect(draft.goals.find((goal) => goal.title === "Test gate")?.qa_profile.rule_selectors).toEqual(["test"])
  })

  test("groups same-surface requirements into a smaller execution graph", async () => {
    const draft = await HeadlessGoalService.initial({
      title: "NoteStore",
      request: "Implement the note-store module and its tests.",
      spec: {
        ...SPEC,
        requirements: [
          {
            id: "req_note_shape",
            title: "Note Interface Definition",
            description: "Export a `Note` interface with exact fields: `id: string`, `title: string`, `done: boolean`, `created_at: number`",
            priority: "blocking" as const,
            acceptance: ["The interface is exported from `src/note-store.ts` and matches the specified shape exactly."],
            evidence_refs: ["Task requirement specifies exact interface shape", "`src/tsconfig.json` confirms strict TypeScript mode"],
          },
          {
            id: "req_note_create",
            title: "NoteStore Class with In-Memory Storage",
            description: "Export a `NoteStore` class backed by `Map<string, Note>` for O(1) lookups by ID.",
            priority: "blocking" as const,
            acceptance: ["Class uses `private notes = new Map<string, Note>()` or equivalent.", "All methods operate on this Map."],
            evidence_refs: ["Task requirement specifies Map-backed storage", "No existing patterns in codebase (greenfield)"],
          },
          {
            id: "req_note_create_method",
            title: "create(title)",
            description: "Trim input title, throw Error on empty result, generate ID via `crypto.randomUUID()`, set `done=false` and `created_at=Date.now()`.",
            priority: "blocking" as const,
            acceptance: ["`create(\"\")` throws.", "`create(\"  \")` throws.", "`create(\"test\")` returns Note with trimmed title, valid UUID, done=false, timestamp."],
            evidence_refs: ["Task requirement specifies exact behavior", "`crypto.randomUUID()` is standard Web Crypto API available in Bun"],
          },
          {
            id: "req_note_get",
            title: "get(id)",
            description: "Return the stored note by id or undefined.",
            priority: "blocking" as const,
            acceptance: ["`get(existingId)` returns the note and `get(\"missing\")` returns `undefined`."],
            evidence_refs: ["Task requirement", "Map.get() returns undefined for missing keys"],
          },
          {
            id: "req_note_list",
            title: "list() Method with Sorting",
            description: "Return all notes sorted by `created_at` ascending.",
            priority: "blocking" as const,
            acceptance: ["Notes are returned in creation order with the oldest note first."],
            evidence_refs: ["Task requirement specifies ascending order by created_at"],
          },
          {
            id: "req_note_toggle",
            title: "toggle(id)",
            description: "Flip note completion in place.",
            priority: "blocking" as const,
            acceptance: ["`src/note-store.ts` flips `done` and persists it."],
            evidence_refs: ["Task requirement specifies flip behavior and return semantics"],
          },
          {
            id: "req_note_remove",
            title: "remove(id)",
            description: "Delete notes and report whether deletion happened.",
            priority: "blocking" as const,
            acceptance: ["`remove(existingId)` returns true and later `get(existingId)` returns `undefined`."],
            evidence_refs: ["Task requirement", "Map.delete() returns boolean"],
          },
          {
            id: "req_note_tests",
            title: "Test Suite Coverage",
            description: "Tests must cover create, empty title, list order, toggle, and remove/get behavior with bun:test.",
            priority: "blocking" as const,
            acceptance: ["`src/note-store.test.ts` covers the required cases."],
            evidence_refs: ["Task requirement specifies exact test cases", "`src/tsconfig.json` includes bun-types"],
            metadata: {
              check_selector: ["test"],
            },
          },
        ],
      } as any,
    })

    expect(draft.goals).toHaveLength(2)
    const implementationGoal = draft.goals.find((goal) => goal.requirement_ids.includes("req_note_shape"))
    const verificationGoal = draft.goals.find((goal) => goal.requirement_ids.includes("req_note_tests"))
    expect(implementationGoal?.requirement_ids).toEqual([
      "req_note_shape",
      "req_note_create",
      "req_note_create_method",
      "req_note_get",
      "req_note_list",
      "req_note_toggle",
      "req_note_remove",
    ])
    expect(implementationGoal?.owned_paths).toContain("src/note-store.ts")
    expect(implementationGoal?.qa_profile.rule_selectors).toEqual(["build"])
    expect(verificationGoal?.requirement_ids).toEqual(["req_note_tests"])
    expect(verificationGoal?.owned_paths).toContain("src/note-store.test.ts")
    expect(verificationGoal?.depends_on_goal_ids).toEqual([implementationGoal!.id])
    expect(verificationGoal?.qa_profile.rule_selectors).toEqual(["test"])
  })
})
