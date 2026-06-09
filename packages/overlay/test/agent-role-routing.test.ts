import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  AGENT_CARD_STAGES,
  agentStageLabel,
  classifyMessage,
  normalizeAgentRole,
  roleLabel,
} from "../src/utils/message"

const EN_US = readFileSync(join(import.meta.dir, "../src/i18n/en-US.json"), "utf8")
const ZH_CN = readFileSync(join(import.meta.dir, "../src/i18n/zh-CN.json"), "utf8")

const SESSION_CARD_STAGES = [
  "assistant",
  "orchestrator",
  "mission",
  "intent-analysis",
  "requirements",
  "frontend-design",
  "frontend-research",
  "visual-qa",
  "goal",
  "architect",
  "integrity",
  "acceptance",
  "executor",
  "build",
  "explore",
  "evaluator",
  "system",
] as const

test("session kinds used by message.channel have explicit agent roles and i18n labels", () => {
  for (const stage of SESSION_CARD_STAGES) {
    const role = normalizeAgentRole(stage)
    expect(AGENT_CARD_STAGES.has(role)).toBe(true)
    expect(roleLabel(role).length).toBeGreaterThan(0)
    expect(agentStageLabel(stage).length).toBeGreaterThan(0)
    if (role !== "assistant") {
      expect(roleLabel(role)).not.toBe("Assistant")
      expect(agentStageLabel(stage)).not.toBe("Assistant")
    }
    expect(EN_US).toContain(`"chat.role.${role}"`)
    expect(ZH_CN).toContain(`"chat.role.${role}"`)
  }
})

test("explore aliases and channel classification stay in the explore card", () => {
  expect(normalizeAgentRole("explorer")).toBe("explore")
  expect(
    classifyMessage(
      {
        info: {
          id: "msg_explore_dispatch",
          channel: "explore",
          resolvedRole: "orchestrator",
          role: "user",
          agent: "build",
        },
      },
      "root",
    ),
  ).toBe("explore")
})
