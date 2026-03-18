import { describe, expect, test } from "bun:test"
import { shouldEnableSpecWebSearch, validateSpecQuality, type SpecOutputType } from "../../src/spec/agent"

const request = `
# Task

Build a complete greenfield diary MVP.

## Features
- auth
- timeline
- editor
- reminders
- sync
- analytics
- settings
- tests
`

function requirement(title: string, evidence_refs: string[] = ["src/app.tsx"]) {
  return {
    id: title.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
    title,
    description: `${title}. Implement and verify this slice with concrete technical constraints.`,
    priority: "blocking" as const,
    acceptance: [`${title} can be verified independently.`],
    evidence_refs,
    metadata: { check_selector: ["build"] },
  }
}

function draft(titles: string[]): SpecOutputType {
  return {
    summary: "Moment Diary MVP specification",
    content: `# Scope

${"Detailed technical design with routes, schemas, state transitions, and test coverage. ".repeat(60)}`,
    scope: "Build the full diary MVP",
    out_of_scope: "Native apps",
    requirements: titles.map((title, index) => requirement(title, [`src/feature-${index + 1}.ts`, "package.json"])),
    assumptions: [],
    risks: ["Browser storage quota"],
    evidence_sources: [
      "src/app.tsx",
      "src/lib/db.ts",
      "src/features/editor.ts",
      "package.json",
      "README.md",
      "docs/architecture.md",
      "src/routes.ts",
      "src/tests/editor.test.ts",
      "src/tests/reminder.test.ts",
      "src/tests/sync.test.ts",
    ],
    unresolved_questions: [],
    clarifications: [],
  }
}

describe("spec quality validation", () => {
  test("disables web search for large benchmark-style PRDs", () => {
    expect(shouldEnableSpecWebSearch(request)).toBe(false)
    expect(shouldEnableSpecWebSearch("Build a Slack webhook notifier with https://api.slack.com docs")).toBe(true)
  })

  test("rejects under-specified requirement drafts for large requests", () => {
    const quality = validateSpecQuality({
      ...draft(["Authentication", "Timeline feed"]),
      content: "# Scope\n\nShort spec without enough grounded technical detail.",
      requirements: [
        requirement("Authentication", []),
        {
          ...requirement("Timeline feed", []),
          acceptance: [],
        },
      ],
      evidence_sources: [],
    }, request, 1)

    expect(quality.score).toBeLessThan(0.6)
    expect(quality.reasons.some((item) => item.includes("under-specified"))).toBe(true)
    expect(quality.reasons.some((item) => item.includes("independently verifiable"))).toBe(true)
  })

  test("accepts grounded requirement-first specs for large requests", () => {
    const quality = validateSpecQuality(draft([
      "Project bootstrap",
      "Authentication module",
      "Editor and draft save",
      "Timeline and calendar browse",
      "Search and filtering",
      "Reminder scheduling",
      "Security lock and encryption",
    ]), request, 14)

    expect(quality.score).toBeGreaterThanOrEqual(0.6)
    expect(quality.reasons.some((item) => item.includes("under-specified"))).toBe(false)
  })
})
