import { expect, test } from "bun:test"
import { buildGoalPrompt } from "../../src/orchestrator/goal-runner"

test("buildGoalPrompt keeps executor scope local to the current goal", () => {
  const prompt = buildGoalPrompt({
    brief: "实现 IndexedDB 存储层",
    plan: {
      summary: "先搭基础设施，再逐 wave 推进功能实现",
      prompt: [
        "FULL_EXECUTION_GUIDE_SHOULD_NOT_APPEAR",
        "## Run Context",
        "The previous attempt did not satisfy the acceptance checks.",
      ].join("\n\n"),
      metadata: {
        risks: ["避免重复搭脚手架", "避免跨 wave 乱改共享入口"],
        failure_summary: "上一轮校验失败，需要聚焦存储层。",
      },
    } as any,
    node: {
      metadata: {
        wave_title: "基础设施搭建",
        wave_objective: "建立数据层和共享类型",
        owned_paths: ["src/data/journal-store.ts", "src/types/journal.ts"],
        consumes: ["app-shell"],
        produces: ["journal-store"],
      },
    } as any,
    goal: {
      description: "实现 IndexedDB 日记仓储层",
      criteria: "创建、读取和更新日记记录的能力可通过测试验证",
      metadata: {
        check_selector: ["build", "test"],
      },
    } as any,
  })

  expect(prompt).toContain("Coordinator context:")
  expect(prompt).toContain("先搭基础设施，再逐 wave 推进功能实现")
  expect(prompt).toContain("Wave contract:")
  expect(prompt).toContain("src/data/journal-store.ts")
  expect(prompt).toContain("Workspace root rule:")
  expect(prompt).toContain("Do not scaffold a nested app or package directory")
  expect(prompt).toContain("## Run Context")
  expect(prompt).toContain("The previous attempt did not satisfy the acceptance checks.")
  expect(prompt).toContain("Failure focus: 上一轮校验失败，需要聚焦存储层。")
  expect(prompt).not.toContain("FULL_EXECUTION_GUIDE_SHOULD_NOT_APPEAR")
})
