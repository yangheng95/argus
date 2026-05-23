import { describe, expect, test } from "bun:test"
import path from "node:path"
import { createRequirementsOutputTools, RequirementRegistrationSchema } from "../../src/requirements/output-tools"
import { parsedRequirementFromRow } from "../../src/requirements/row"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const requirementsPromptPath = path.join(
  repoRoot,
  "packages/opencorvus/src/prompt/core/requirements-core.txt",
)

async function readRequirementsPrompt() {
  return await Bun.file(requirementsPromptPath).text()
}

describe("requirements maturity word discipline", () => {
  test("prompt requires vague maturity words to land or be clarified", async () => {
    const prompt = await readRequirementsPrompt()

    expect(prompt).toContain("Vague maturity / quality words")
    expect(prompt).toContain("成熟")
    expect(prompt).toContain("maturity_scope_pending")
    expect(prompt).toContain("Never leave a maturity word implicit")
  })

  test("prompt requires requirement acceptance and non-goal boundaries", async () => {
    const prompt = await readRequirementsPrompt()

    expect(prompt).toContain("Every `register_requirement` call MUST populate `acceptance`")
    expect(prompt).toContain("`register_requirement({ id, type, description, acceptance, non_goals })`")
    expect(prompt).toContain("`acceptance`: one sentence naming the observable success condition")
    expect(prompt).toContain("`non_goals`: one sentence naming nearby behavior")
  })

  test("register_requirement schema rejects empty acceptance and non-goals", () => {
    expect(RequirementRegistrationSchema.safeParse({
      id: "REQ-1",
      type: "explicit",
      description: "A mature chat page supports normal chat.",
      acceptance: "",
      non_goals: "This does not cover unrelated admin dashboards.",
    }).success).toBe(false)

    expect(RequirementRegistrationSchema.safeParse({
      id: "REQ-1",
      type: "explicit",
      description: "A mature chat page supports normal chat.",
      acceptance: "The user can send one message and see a response.",
      non_goals: "",
    }).success).toBe(false)
  })

  test("collector preserves acceptance and non-goal boundaries", async () => {
    const kit = createRequirementsOutputTools()

    await kit.tools.register_requirement.execute({
      id: "REQ-1",
      type: "explicit",
      description: "输入 DeepSeek API Key 后可以聊天。",
      acceptance: "输入有效 Key 后，用户发送消息会看到中文界面中的助手回复。",
      non_goals: "本 REQ 不覆盖多账号同步、云端历史或后台管理。",
    }, {} as any)

    expect(kit.getCollector().requirements).toEqual([
      {
        id: "REQ-1",
        type: "explicit",
        description: "输入 DeepSeek API Key 后可以聊天。",
        acceptance: "输入有效 Key 后，用户发送消息会看到中文界面中的助手回复。",
        non_goals: "本 REQ 不覆盖多账号同步、云端历史或后台管理。",
      },
    ])
  })

  test("requirement DB rows project acceptance and non-goals into ParsedRequirement", () => {
    expect(parsedRequirementFromRow({
      id: "req_db",
      task_id: "tsk",
      spec_snapshot_id: "spc",
      title: "Stored requirement",
      description: "Stored requirement description.",
      status: "pending",
      priority: "blocking",
      acceptance: JSON.stringify(["observable success"]),
      evidence_refs: null,
      non_goals: ["nearby non-goal"],
      metadata: { source_requirement_id: "REQ-1" },
      order_index: 0,
      time_created: 1,
      time_updated: 1,
    })).toEqual({
      id: "REQ-1",
      type: "explicit",
      description: "Stored requirement description.",
      acceptance: "observable success",
      non_goals: "nearby non-goal",
    })
  })
})
