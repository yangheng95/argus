import { describe, test, expect } from "bun:test"

// Inline the regex patterns to test them independently
const FILE_EXTS = "ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|json|yaml|yml|toml|md|css|html|sql|sh|vue|svelte"

function extractFileRefs(request: string): string[] {
  const refs = new Set<string>()
  let match: RegExpExecArray | null

  // Pattern 1: @file:path or @path
  const atPat = /@(?:file:)?([./a-zA-Z][\w./\\-]*\.\w+)/g
  while ((match = atPat.exec(request)) !== null) refs.add(match[1])

  // Pattern 2: Backtick-wrapped paths
  const btPat = new RegExp("`([./]?(?:[\\w@-]+[/\\\\])*[\\w.-]+\\.(?:" + FILE_EXTS + "))`", "g")
  while ((match = btPat.exec(request)) !== null) refs.add(match[1])

  // Pattern 3: Bare relative paths with at least one slash
  const barePat = new RegExp(
    "(?:^|[\\s,;，；（(])(\\.?(?:[\\w@-]+[/\\\\])+[\\w.-]+\\.(?:" + FILE_EXTS + "))(?=[\\s,;，；）)。:：]|$)",
    "gm",
  )
  while ((match = barePat.exec(request)) !== null) refs.add(match[1].trim())

  return [...refs]
}

function extractRequirements(request: string): string[] {
  const CN_ACTION_PAT =
    /^(?:添加|修改|删除|创建|导出|导入|确保|实现|重构|优化|移除|更新|替换|支持|使用|配置|设置|检查|启用|禁用)/
  const EN_ACTION_PAT =
    /^(?:add|create|modify|delete|remove|implement|ensure|replace|fix|refactor|export|import|enable|disable|configure|check|support)\s/i
  const requirements: string[] = []
  for (const line of request.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.length < 4) continue
    if (/^[-*•]\s+/.test(trimmed)) {
      requirements.push(trimmed.replace(/^[-*•]\s+/, ""))
    } else if (/^\d+[.、)）]\s+/.test(trimmed)) {
      requirements.push(trimmed.replace(/^\d+[.、)）]\s+/, ""))
    } else if (CN_ACTION_PAT.test(trimmed) || EN_ACTION_PAT.test(trimmed)) {
      requirements.push(trimmed)
    }
  }
  return requirements
}

function extractEntities(request: string): string[] {
  const entitySet = new Set<string>()
  let match: RegExpExecArray | null
  // English order: keyword Name
  const entPat = /`(\w+)`|(?:class|type|interface|function|method)\s+(\w+)/gi
  while ((match = entPat.exec(request)) !== null) {
    const name = match[1] || match[2]
    if (name && name.length > 1 && !/^(the|and|or|is|to|a|of|in)$/i.test(name)) entitySet.add(name)
  }
  // Chinese order: Name 类型/方法/函数/接口
  const cnPat = /(\w{2,})\s*(?:类型|类|方法|函数|接口)/g
  while ((match = cnPat.exec(request)) !== null) {
    entitySet.add(match[1])
  }
  return [...entitySet]
}

function extractWorkDir(request: string): string | undefined {
  const cwdMatch =
    request.match(/(?:绝对路径|absolute path)[：:\s]*([A-Z]:[/\\][^\s)）]+|\/[^\s)）]+)/i) ??
    request.match(/(?:工作目录|working dir(?:ectory)?)[^\n]*?([A-Z]:[/\\][^\s)）]+|\/[^\s)）]+)/i)
  return cwdMatch ? cwdMatch[1].replace(/[/\\]+$/, "") : undefined
}

describe("pre-analysis: file ref extraction", () => {
  test("bare paths in Chinese text", () => {
    const request = `src/router.ts 中有一个简单的 Router 类，只支持 GET/POST 路由。
确保现有测试（src/router.test.ts）和新的中间件测试（src/middleware.test.ts）都通过。
只修改 src/router.ts。`

    const refs = extractFileRefs(request)
    expect(refs).toContain("src/router.ts")
    expect(refs).toContain("src/router.test.ts")
    expect(refs).toContain("src/middleware.test.ts")
  })

  test("backtick-wrapped paths", () => {
    const request = "Modify `src/router.ts` and check `src/middleware.test.ts`"
    const refs = extractFileRefs(request)
    expect(refs).toContain("src/router.ts")
    expect(refs).toContain("src/middleware.test.ts")
  })

  test("@-prefixed paths", () => {
    const request = "See @file:src/router.ts and @src/handler.ts for details"
    const refs = extractFileRefs(request)
    expect(refs).toContain("src/router.ts")
    expect(refs).toContain("src/handler.ts")
  })

  test("mixed patterns", () => {
    const request = "Modify `src/a.ts`, @src/b.ts, and src/c.ts in the project."
    const refs = extractFileRefs(request)
    expect(refs).toContain("src/a.ts")
    expect(refs).toContain("src/b.ts")
    expect(refs).toContain("src/c.ts")
  })

  test("does not match words without slashes", () => {
    const request = "Implement the router.ts changes"
    const refs = extractFileRefs(request)
    // "router.ts" without a slash should NOT match bare pattern (to avoid false positives)
    // But @router.ts would match via @pattern
    expect(refs).not.toContain("router.ts")
  })

  test("handles parenthesized paths (Chinese)", () => {
    const request = "确保测试（src/router.test.ts）通过"
    const refs = extractFileRefs(request)
    expect(refs).toContain("src/router.test.ts")
  })
})

describe("pre-analysis: requirement extraction", () => {
  test("extracts bullet points", () => {
    const request = `请添加中间件支持：
- 添加 Middleware 类型
- 导出 Middleware 类型
- 添加 use 方法`
    const reqs = extractRequirements(request)
    expect(reqs).toEqual(["添加 Middleware 类型", "导出 Middleware 类型", "添加 use 方法"])
  })

  test("extracts numbered items", () => {
    const request = `Steps:
1. Read the file
2. Add the type
3. Run tests`
    const reqs = extractRequirements(request)
    expect(reqs.length).toBe(3)
    expect(reqs[0]).toBe("Read the file")
  })

  test("extracts action-verb lines (Chinese)", () => {
    const request = `添加 Middleware 类型
导出 Middleware 类型
修改 handle 方法
确保测试通过`
    const reqs = extractRequirements(request)
    expect(reqs.length).toBe(4)
    expect(reqs[0]).toBe("添加 Middleware 类型")
  })

  test("ignores non-list non-action lines", () => {
    const request = "Just do the thing"
    const reqs = extractRequirements(request)
    expect(reqs.length).toBe(0)
  })
})

describe("pre-analysis: entity extraction", () => {
  test("extracts backtick-wrapped entities", () => {
    const request = "Add a `Middleware` type and `use` method to `Router`"
    const entities = extractEntities(request)
    expect(entities).toContain("Middleware")
    expect(entities).toContain("use")
    expect(entities).toContain("Router")
  })

  test("extracts type/class/function keywords", () => {
    const request = "添加 Middleware 类型 and class Router"
    const entities = extractEntities(request)
    expect(entities).toContain("Middleware")
    expect(entities).toContain("Router")
  })
})

describe("pre-analysis: working directory extraction", () => {
  test("extracts from 绝对路径", () => {
    const request =
      "工作目录是 eval-workspace/e5（绝对路径: D:/myhexin-local/opencorvus-local/packages/opencorvus/eval-workspace/e5）"
    const workDir = extractWorkDir(request)
    expect(workDir).toBe("D:/myhexin-local/opencorvus-local/packages/opencorvus/eval-workspace/e5")
  })

  test("extracts from working directory", () => {
    const request = "The working directory is /home/user/project/src"
    const workDir = extractWorkDir(request)
    expect(workDir).toBe("/home/user/project/src")
  })

  test("returns undefined when no workdir", () => {
    const request = "Just fix the bug"
    const workDir = extractWorkDir(request)
    expect(workDir).toBeUndefined()
  })
})
