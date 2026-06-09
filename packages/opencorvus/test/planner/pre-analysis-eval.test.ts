import { describe, test, expect } from "bun:test"

/**
 * Test pre-analysis against the exact eval task request that triggered
 * the "shallow plan" complaint.
 */

const FILE_EXTS = "ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|json|yaml|yml|toml|md|css|html|sql|sh|vue|svelte"

function extractFileRefs(request: string): string[] {
  const refs = new Set<string>()
  let match: RegExpExecArray | null

  const atPat = /@(?:file:)?([./a-zA-Z][\w./\\-]*\.\w+)/g
  while ((match = atPat.exec(request)) !== null) refs.add(match[1])

  const btPat = new RegExp("`([./]?(?:[\\w@-]+[/\\\\])*[\\w.-]+\\.(?:" + FILE_EXTS + "))`", "g")
  while ((match = btPat.exec(request)) !== null) refs.add(match[1])

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

function extractWorkDir(request: string): string | undefined {
  const cwdMatch =
    request.match(/(?:绝对路径|absolute path)[：:\s]*([A-Z]:[/\\][^\s)）]+|\/[^\s)）]+)/i) ??
    request.match(/(?:工作目录|working dir(?:ectory)?)[^\n]*?([A-Z]:[/\\][^\s)）]+|\/[^\s)）]+)/i)
  return cwdMatch ? cwdMatch[1].replace(/[/\\]+$/, "") : undefined
}

function buildSmartSteps(analysis: { files: Array<{ ref: string }>; requirements: string[] }): string[] {
  if (analysis.files.length === 0 && analysis.requirements.length === 0) {
    return [
      "Explore the codebase to understand architecture, conventions, and affected areas.",
      "Use the planner tool to decompose the task into a hierarchical subtask tree.",
      "Execute each subtask in order, updating planner status as you go.",
      "Run acceptance checks and verify the requested outcome.",
    ]
  }

  const steps: string[] = []
  if (analysis.files.length > 0) {
    steps.push(`Analyze source files: ${analysis.files.map((f) => f.ref).join(", ")}`)
  }
  if (analysis.requirements.length > 0) {
    for (const req of analysis.requirements) {
      steps.push(req)
    }
  } else {
    steps.push("Plan and implement the requested changes based on the source analysis.")
  }
  steps.push("Run acceptance checks (build, test, lint) and verify all goals pass.")
  return steps
}

describe("eval task: middleware router", () => {
  const EVAL_REQUEST = `工作目录
本任务的工作目录是 eval-workspace-1772975037078/e5（绝对路径: D:/myhexin-local/argus-opencode/packages/opencorvus/eval-workspace-1772975037078/e5）。
所有源代码文件都在这个目录下。请先用以下命令切换到工作目录：
cd "D:/myhexin-local/argus-opencode/packages/opencorvus/eval-workspace-1772975037078/e5"
然后查看目录结构和文件内容，理解当前代码后再开始修改。
任务描述
src/router.ts 中有一个简单的 Router 类，只支持 GET/POST 路由。
请添加中间件支持：
添加 Middleware 类型: (req: Request, next: (req: Request) => Promise<Response>) => Promise<Response>
导出 Middleware 类型
添加 use(middleware: Middleware): this 方法到 Router
修改 handle 方法，在调用路由 handler 前执行中间件链
中间件按注册顺序执行，形成洋葱模型（先进后出）
中间件可以短路（不调用 next 直接返回 Response）
确保现有测试（src/router.test.ts）和新的中间件测试（src/middleware.test.ts）都通过。
只修改 src/router.ts。`

  test("extracts working directory", () => {
    const workDir = extractWorkDir(EVAL_REQUEST)
    expect(workDir).toBe("D:/myhexin-local/argus-opencode/packages/opencorvus/eval-workspace-1772975037078/e5")
  })

  test("extracts all file references", () => {
    const refs = extractFileRefs(EVAL_REQUEST)
    expect(refs).toContain("src/router.ts")
    expect(refs).toContain("src/router.test.ts")
    expect(refs).toContain("src/middleware.test.ts")
  })

  test("generates task-specific plan steps", () => {
    const refs = extractFileRefs(EVAL_REQUEST)
    const reqs = extractRequirements(EVAL_REQUEST)

    const steps = buildSmartSteps({
      files: refs.map((ref) => ({ ref })),
      requirements: reqs,
    })

    // Should NOT be generic
    expect(steps[0]).toContain("src/router.ts")
    expect(steps.length).toBeGreaterThan(4) // More specific than the 4 generic steps
    expect(steps[steps.length - 1]).toContain("acceptance checks")

    console.log("Generated steps:")
    steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`))
  })

  test("full plan is NOT generic 4-step template", () => {
    const refs = extractFileRefs(EVAL_REQUEST)
    const reqs = extractRequirements(EVAL_REQUEST)

    const steps = buildSmartSteps({
      files: refs.map((ref) => ({ ref })),
      requirements: reqs,
    })

    // Must NOT match the old generic fallback
    expect(steps).not.toContain("Explore the codebase to understand architecture, conventions, and affected areas.")
    expect(steps).not.toContain("Use the planner tool to decompose the task into a hierarchical subtask tree.")
  })
})
