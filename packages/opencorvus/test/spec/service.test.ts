import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { SpecAgent } from "../../src/spec/agent"
import { SpecService } from "../../src/spec/service"

const broad = {
  summary: "日记应用规格",
  content: "# Scope\n\n实现完整应用。",
  scope: "实现完整应用",
  goals: [
    {
      description: "构建完整的React+TypeScript日记应用架构，包含组件设计、数据模型、状态管理、路由结构",
      criteria: "应用基础架构、组件体系和页面路由全部完成",
      priority: "blocking" as const,
    },
  ],
  spec_items: [
    {
      title: "项目初始化和基础架构搭建",
      description: "在工作区根目录完成项目初始化、构建配置和入口文件搭建",
      priority: "blocking" as const,
      check_selector: ["build"],
    },
    {
      title: "数据模型和IndexedDB层设计",
      description: "实现日记数据模型与 IndexedDB 读写层，并补上验证存取的测试",
      priority: "blocking" as const,
      check_selector: ["test"],
    },
    {
      title: "状态管理架构",
      description: "建立应用状态管理层，连接编辑器、列表和筛选状态",
      priority: "blocking" as const,
      check_selector: ["build"],
    },
    {
      title: "路由和页面结构",
      description: "实现页面路由骨架并保证主要页面可访问",
      priority: "blocking" as const,
      check_selector: ["build"],
    },
  ],
  assumptions: [],
  risks: [],
  evidence_sources: ["src/main.tsx", "package.json"],
  unresolved_questions: [],
}

const noDirectGoals = {
  ...broad,
  goals: undefined,
}

describe("spec.service goal derivation", () => {
  afterEach(() => {
    mock.restore()
  })

  test("derives execution goals from spec items when model goals are broad", async () => {
    spyOn(SpecAgent, "initial").mockResolvedValue(broad as any)

    const spec = await SpecService.initial({
      title: "实现日记应用",
      request: "实现一个完整的日记应用。",
    })

    expect(spec.goals).toHaveLength(4)
    expect(spec.goals.map((goal) => goal.description)).toEqual(broad.spec_items.map((item) => item.title))
    expect(spec.goals[0]?.criteria).toBe(broad.spec_items[0]?.description)
    expect(spec.goals[1]?.metadata).toEqual({
      check_selector: ["test"],
    })
  })

  test("trims oversized derived spec items into an execution tranche for budgeted runs", async () => {
    spyOn(SpecAgent, "initial").mockResolvedValue({
      ...broad,
      content: "# Scope\n\n" + "实现完整日记应用。".repeat(600),
      scope: "实现完整日记应用 MVP。",
      out_of_scope: "桌面端适配",
      spec_items: Array.from({ length: 8 }, (_, index) => ({
        title: `阶段 ${index + 1}`,
        description: `完成第 ${index + 1} 个交付目标`,
        priority: "blocking" as const,
        check_selector: ["build"],
      })),
    } as any)

    const spec = await SpecService.initial({
      title: "实现日记应用",
      request: "实现一个完整的日记应用。",
      metadata: {
        orchestrator_budget: {
          max_wall_time_ms: 4 * 60 * 60 * 1000,
        },
      },
    })

    expect(spec.goals).toHaveLength(4)
    expect(spec.spec_items).toHaveLength(4)
    expect(spec.goals.map((goal) => goal.description)).toEqual(["阶段 1", "阶段 2", "阶段 3", "阶段 4"])
    expect(spec.content).toContain("## Execution Tranche")
    expect(spec.content).toContain("## Deferred For Later Iterations")
    expect(spec.content).toContain("阶段 8")
    expect((spec as { out_of_scope?: string }).out_of_scope).toContain("Deferred for later iterations")
  })

  test("drops ui_review from architecture bootstrap items", async () => {
    spyOn(SpecAgent, "initial").mockResolvedValue({
      ...broad,
      spec_items: [{
        title: "项目架构初始化与技术栈配置",
        description: "搭建 Expo + React Native 项目结构，配置路由、状态管理和 UI 组件库，建立模块目录。",
        priority: "blocking" as const,
        check_selector: ["startup", "ui_review"],
      }],
    } as any)

    const spec = await SpecService.initial({
      title: "实现日记应用",
      request: "实现一个完整的日记应用。",
    })

    expect(spec.spec_items[0]?.check_selector).toEqual(["startup"])
    expect(spec.goals[0]?.metadata).toEqual({
      check_selector: ["startup"],
    })
  })

  test("keeps caller-supplied goals when explicit goals were provided", async () => {
    spyOn(SpecAgent, "initial").mockResolvedValue(broad as any)

    const spec = await SpecService.initial({
      title: "实现日记应用",
      request: "实现一个完整的日记应用。",
      goals: [
        {
          description: "优先实现数据存储层",
          criteria: "数据可保存并可重新读取",
          priority: "blocking",
        },
      ],
    })

    expect(spec.goals).toHaveLength(1)
    expect(spec.goals[0]?.description).toBe("优先实现数据存储层")
    expect(spec.goals[0]?.criteria).toBe("数据可保存并可重新读取")
  })

  test("rewrite preserves explicit goals when raw-text spec omits structured goals", async () => {
    spyOn(SpecAgent, "rewrite").mockResolvedValue(noDirectGoals as any)

    const spec = await SpecService.rewrite({
      title: "实现日记应用",
      request: "修复日记 CRUD 和状态管理问题。",
      rewriteContext: {
        previousSpec: broad.content,
        failureAnalysis: {
          classification: "strategy",
          summary: "上一轮没有完成关键功能",
          rootCause: "重规划丢失了目标",
          suggestedStrategy: "保留已有 goals 并重新拆分",
          avoidApproaches: [],
        },
        previousGoalStatuses: [],
      },
      goals: [
        {
          description: "修复日记 CRUD 服务",
          criteria: "create/update/delete/search 全部可用",
          priority: "blocking",
        },
        {
          description: "补齐核心页面",
          criteria: "首页、编辑页、搜索页、日历页可实际使用",
          priority: "blocking",
        },
      ],
    })

    expect(spec.goals).toHaveLength(2)
    expect(spec.goals[0]).toMatchObject({
      description: "修复日记 CRUD 服务",
      criteria: "create/update/delete/search 全部可用",
      priority: "blocking",
    })
    expect(spec.goals[1]).toMatchObject({
      description: "补齐核心页面",
      criteria: "首页、编辑页、搜索页、日历页可实际使用",
      priority: "blocking",
    })
  })
})
