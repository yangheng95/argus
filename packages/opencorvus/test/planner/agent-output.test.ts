import { describe, expect, test } from "bun:test"
import { parsePlannerOutput, validatePlanQuality } from "../../src/planner/agent"
import { parseSpecMarkdown, parseSpecOutput } from "../../src/spec/agent"

describe("agent output parsing", () => {
  test("planner output throws when JSON is unrecoverable", () => {
    expect(() => parsePlannerOutput("{")).toThrow("planner output invalid JSON")
  })

  test("planner output throws when schema validation fails", () => {
    expect(() =>
      parsePlannerOutput(JSON.stringify({
        prd: 5,
        summary: "bad",
        subtasks: [],
        risks: [],
      })),
    ).toThrow("planner output failed schema validation")
  })

  test("planner quality accepts waves that normalize into one goal per stage", () => {
    const quality = validatePlanQuality({
      summary: "Implement note store",
      prd: [
        "- Update src/note-store.ts and src/note-store.test.ts",
        "- Keep package.json and tsconfig.json unchanged",
        "- Verify with bun test src/note-store.test.ts",
      ].join("\n"),
      waves: [{
        title: "Implementation and verification",
        objective: "Build the note store incrementally",
        goal_indices: [0, 1, 2, 3],
        owned_paths: ["src/note-store.ts", "src/note-store.test.ts"],
      }],
      subtasks: [
        {
          title: "Implement note store",
          description: "Update src/note-store.ts and verify with bun test src/note-store.test.ts",
          order: 1,
        },
        {
          title: "Add tests",
          description: "Update src/note-store.test.ts and check bun test src/note-store.test.ts",
          order: 2,
        },
      ],
      risks: [],
      assumptions: [],
    }, "Implement a note store in src/note-store.ts with tests in src/note-store.test.ts", 6, 4)

    expect(quality.score).toBeGreaterThanOrEqual(0.5)
    expect(quality.reasons.some((item) => item.includes("iterative wave"))).toBe(false)
  })

  test("spec output repairs truncated empty JSON into an empty draft", () => {
    expect(parseSpecOutput("{")).toMatchObject({
      summary: "",
      content: "",
      scope: "",
      requirements: [],
    })
  })

  test("spec output throws when schema validation fails", () => {
    expect(() =>
      parseSpecOutput(JSON.stringify({
        summary: "bad",
        content: "bad",
        scope: 5,
        requirements: [],
        assumptions: [],
        risks: [],
        evidence_sources: [],
        unresolved_questions: [],
      })),
    ).toThrow("spec output failed schema validation")
  })

  test("spec markdown reads nested heading items under requirements", () => {
    const parsed = parseSpecMarkdown(`
# Summary

Diary application specification

# Requirements

## 1. Project bootstrap and config
Create the Expo project structure and configure package.json, app.json, and tsconfig.json.
- Verification: run npm start.

## 2. Local storage schema
Define users, entries, and sync_queue tables in src/db/schema.ts.
- Verification: run bun test test/storage.test.ts.

# Evidence

- package.json
`)

    expect(parsed.requirements.map((item) => item.title)).toEqual([
      "Project bootstrap and config",
      "Local storage schema",
    ])
    expect(parsed.requirements[0]?.evidence_refs).toContain("package.json")
    expect(parsed.requirements[1]?.acceptance).toContain("run bun test test/storage.test.ts.")
  })

  test("spec markdown keeps bold numbered requirements intact", () => {
    const parsed = parseSpecMarkdown(`
# Summary

Diary application specification

# Requirements

**1. App bootstrap**
- Use bun create expo to initialize the project and build configuration.
- Verification: run bun x expo export --platform web --output-dir dist.

**2. Storage implementation**
- Create note entities in src/models and persistence code in src/storage.
- Verification: run bun test test/storage.test.ts.
`)

    expect(parsed.requirements.map((item) => item.title)).toEqual([
      "App bootstrap",
      "Storage implementation",
    ])
    expect(parsed.requirements).toHaveLength(2)
    expect(parsed.requirements.some((item) => item.title.includes("Verification"))).toBe(false)
    expect(parsed.requirements[0]?.description).toContain("bun create expo")
    expect(parsed.requirements[1]?.acceptance).toContain("run bun test test/storage.test.ts.")
  })
})

test("spec markdown ignores preface lines before numbered requirements", () => {
  const parsed = parseSpecMarkdown(`
# Summary

Diary application specification

# Requirements

Included modules:

1. Editor CRUD
- Description: implement create, edit, delete, and draft save in app/editor.tsx and src/store/note.ts.
- Verification: run bun test test/editor.test.ts.
- Check Selector: test

2. Timeline home
- Description: render date-grouped entries in app/index.tsx.
- Verification: launching the app shows a created entry.
- Check Selector: startup
`)

  expect(parsed.requirements.map((item) => item.title)).toEqual(["Included modules", "Editor CRUD", "Timeline home"])
})

test("spec markdown expands broad numbered requirements into child bullet requirements", () => {
  const parsed = parseSpecMarkdown(`
# Summary

Moment Diary specification

# Requirements

1. Implement auth, storage, and sync platform
- Configure login flow and password lockout.
- Create local storage schema and repositories.
- Implement offline sync queue and retry policy.

2. Search and filtering
- Implement keyword search and saved filters.
`)

  expect(parsed.requirements.map((item) => item.title)).toEqual([
    "Implement auth, storage, and sync platform",
    "Search and filtering",
  ])
})
