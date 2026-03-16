import { describe, expect, test } from "bun:test"
import { isBroadSpecItem, shouldEnableSpecWebSearch, validateSpecQuality, type SpecOutputType } from "../../src/spec/agent"

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

function item(title: string) {
  return {
    title,
    description: `${title}. Implement and verify this slice with concrete technical constraints.`,
    priority: "blocking" as const,
    check_selector: ["build"],
  }
}

function draft(titles: string[]): SpecOutputType {
  return {
    summary: "Moment Diary MVP specification",
    content: `# Scope

${"Detailed technical design with routes, schemas, state transitions, and test coverage. ".repeat(60)}`,
    scope: "Build the full diary MVP",
    out_of_scope: "Native apps",
    spec_items: titles.map(item),
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

  test("recognizes broad umbrella items", () => {
    expect(isBroadSpecItem(item("Implement auth, storage, and sync platform"))).toBe(true)
    expect(isBroadSpecItem(item("Implement database, sync, and search pipeline"))).toBe(true)
    expect(isBroadSpecItem(item("Search and filtering"))).toBe(false)
    expect(isBroadSpecItem(item("React Native + Expo 项目初始化"))).toBe(false)
    expect(isBroadSpecItem(item("用户认证模块（注册/登录）"))).toBe(false)
    expect(isBroadSpecItem(item("应用锁与安全加密模块"))).toBe(false)
  })

  test("allows up to two broad items for large greenfield requests", () => {
    const quality = validateSpecQuality(draft([
      "Implement auth, storage, and sync platform",
      "Implement database, sync, and search pipeline",
      "Timeline feed",
      "Calendar browsing",
      "Search and filtering",
      "Reminder scheduling",
      "Analytics dashboard",
      "Settings center",
      "Editor interactions",
      "Test coverage",
    ]), request, 18)

    expect(quality.score).toBeGreaterThanOrEqual(0.6)
    expect(quality.reasons).toHaveLength(0)
  })

  test("still rejects large requests with too many broad items", () => {
    const quality = validateSpecQuality(draft([
      "Implement auth, storage, and sync platform",
      "Implement database, sync, and search pipeline",
      "Implement auth, database, and security platform",
      "Timeline feed",
      "Calendar browsing",
      "Search and filtering",
      "Reminder scheduling",
      "Analytics dashboard",
      "Settings center",
      "Test coverage",
    ]), request, 18)

    expect(quality.score).toBeLessThan(0.6)
    expect(quality.reasons.some((item) => item.includes("umbrella item"))).toBe(true)
  })

  test("accepts seven execution-sized items for large requests", () => {
    const quality = validateSpecQuality(draft([
      "React Native + Expo 项目初始化",
      "用户认证模块（注册/登录）",
      "编辑器与草稿保存",
      "时间轴与日历浏览",
      "搜索与筛选功能",
      "提醒调度",
      "应用锁与安全加密模块",
    ]), request, 14)

    expect(quality.score).toBeGreaterThanOrEqual(0.6)
    expect(quality.reasons).toHaveLength(0)
  })
})
