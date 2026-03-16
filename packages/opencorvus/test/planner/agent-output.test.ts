import { describe, expect, test } from "bun:test"
import { parsePlannerOutput } from "../../src/planner/agent"
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

  test("spec output throws when JSON is unrecoverable", () => {
    expect(() => parseSpecOutput("{")).toThrow("spec output invalid JSON")
  })

  test("spec output throws when schema validation fails", () => {
    expect(() =>
      parseSpecOutput(JSON.stringify({
        summary: "bad",
        content: "bad",
        scope: 5,
        goals: [],
        spec_items: [],
        assumptions: [],
        risks: [],
        evidence_sources: [],
        unresolved_questions: [],
      })),
    ).toThrow("spec output failed schema validation")
  })



  test("spec markdown reads nested heading items under spec items section", () => {
    const parsed = parseSpecMarkdown(`
# Summary

\u65e5\u8bb0\u5e94\u7528\u89c4\u683c

# Spec Items

## 1. \u9879\u76ee\u521d\u59cb\u5316\u4e0e\u914d\u7f6e
\u521b\u5efa Expo \u9879\u76ee\u57fa\u7840\u7ed3\u6784\uff0c\u914d\u7f6e package.json \u3001 app.json \u548c tsconfig.json\u3002
- \u9a8c\u8bc1\uff1a\u8fd0\u884c npx expo start\u3002

## 2. \u672c\u5730\u6570\u636e\u5e93 Schema \u5b9e\u73b0
\u5728 src/db/schema.ts \u5b9a\u4e49 users \u3001 diaries \u3001 sync_queue \u8868\u7ed3\u6784\u3002
- \u9a8c\u8bc1\uff1a\u8fd0\u884c bun test test/storage.test.ts\u3002

# Evidence

- package.json
`)

    expect(parsed.spec_items.map((item) => item.title)).toEqual([
      "\u9879\u76ee\u521d\u59cb\u5316\u4e0e\u914d\u7f6e",
      "\u672c\u5730\u6570\u636e\u5e93 Schema \u5b9e\u73b0",
    ])
    expect(parsed.spec_items[0]?.description).toContain("package.json")
    expect(parsed.spec_items[1]?.check_selector).toContain("test")
  })

  test("spec markdown keeps bold numbered items intact", () => {
    const parsed = parseSpecMarkdown(`
# Summary

\u65e5\u8bb0\u5e94\u7528\u89c4\u683c

# Spec Items

**1. \u9879\u76ee\u521d\u59cb\u5316\u4e0e\u67b6\u6784\u642d\u5efa**
- \u4f7f\u7528 bun create expo \u521b\u5efa\u9879\u76ee\u5e76\u8865\u9f50\u6784\u5efa\u914d\u7f6e\u3002
- \u76ee\u5f55\u7ed3\u6784\uff1aapp/\u3001src/components/\u3001src/features/\u3002
- \u9a8c\u8bc1\u65b9\u5f0f\uff1a\u8fd0\u884c bun x expo export --platform web --output-dir dist\u3002

**2. \u6570\u636e\u6a21\u578b\u4e0e\u672c\u5730\u5b58\u50a8\u5b9e\u73b0**
- \u5728 src/models/ \u521b\u5efa\u65e5\u8bb0\u5b9e\u4f53\uff0c\u5728 src/storage/ \u5b9e\u73b0\u6301\u4e45\u5316\u3002
- \u9a8c\u8bc1\u65b9\u5f0f\uff1a\u8fd0\u884c bun test test/storage.test.ts\u3002
`)

    expect(parsed.spec_items.map((item) => item.title)).toEqual([
      "\u9879\u76ee\u521d\u59cb\u5316\u4e0e\u67b6\u6784\u642d\u5efa",
      "\u6570\u636e\u6a21\u578b\u4e0e\u672c\u5730\u5b58\u50a8\u5b9e\u73b0",
    ])
    expect(parsed.spec_items).toHaveLength(2)
    expect(parsed.spec_items.some((item) => item.title.includes("\u9a8c\u8bc1\u65b9\u5f0f"))).toBe(false)
    expect(parsed.spec_items[0]?.description).toContain("bun create expo")
    expect(parsed.spec_items[1]?.check_selector).toContain("test")
  })
})

test("spec markdown ignores preface lines before numbered spec items", () => {
  const parsed = parseSpecMarkdown(`
# Summary

日记应用规格

# Spec Items

包含的功能模块：

1. 编辑器 CRUD
- Description: 在 app/editor.tsx 和 src/store/note.ts 中实现新增、编辑、删除和草稿保存。
- Verification: 运行 bun test test/editor.test.ts。
- Check Selector: test

2. 时间轴首页
- Description: 在 app/index.tsx 渲染按日期分组的日记列表。
- Verification: 启动后首页可展示新建记录。
- Check Selector: startup
`)

  expect(parsed.spec_items.map((item) => item.title)).toEqual(["编辑器 CRUD", "时间轴首页"])
})


test("spec markdown expands broad numbered items into child bullet items", () => {
  const parsed = parseSpecMarkdown(`
# Summary

Moment Diary specification

# Spec Items

1. Implement auth, storage, and sync platform
- Configure login flow and password lockout.
- Create local storage schema and repositories.
- Implement offline sync queue and retry policy.

2. Search and filtering
- Implement keyword search and saved filters.
`)

  expect(parsed.spec_items.map((item) => item.title)).toEqual([
    "Configure login flow and password lockout.",
    "Create local storage schema and repositories.",
    "Implement offline sync queue and retry policy.",
    "Search and filtering",
  ])
})
