import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import type { Agent } from "../../src/agent/agent"
import { LLM } from "../../src/session/llm"
import type { Message } from "../../src/session/message"
import type { Provider } from "../../src/provider/provider"

const model = {
  providerID: "test",
  id: "test-model",
  api: { id: "test-model" },
} as Provider.Model

const agent = {
  name: "requirements",
  mode: "primary",
  prompt: "AGENT REGISTRY PROMPT",
} as Agent.Info

function user(systemMode?: Message.User["systemMode"]): Message.User {
  return {
    id: "msg_test",
    sessionID: "ses_test",
    role: "user",
    time: { created: 0 },
    agent: agent.name,
    model: { providerID: model.providerID, modelID: model.id },
    system: "RUNNER STAGE CORE",
    systemMode,
  } as Message.User
}

test("complete system mode omits agent and provider prelude from final LLM system", async () => {
  const system = await LLM.composeSystem({
    agent,
    model,
    system: ["RUNNER RUNTIME CONTEXT"],
    user: user("complete"),
  })

  expect(system).toEqual(["RUNNER RUNTIME CONTEXT\nRUNNER STAGE CORE"])
  expect(system[0]).not.toContain("AGENT REGISTRY PROMPT")
})

test("default system mode appends caller system after the agent prompt", async () => {
  const system = await LLM.composeSystem({
    agent,
    model,
    system: ["CALLER RUNTIME CONTEXT"],
    user: user(),
  })

  expect(system).toEqual(["AGENT REGISTRY PROMPT\nCALLER RUNTIME CONTEXT\nRUNNER STAGE CORE"])
})

test("runtime prompt call sites mark complete system prompts explicitly", async () => {
  const srcRoot = path.join(import.meta.dir, "..", "..", "src")
  const files = [
    "agent/runner.ts",
    "control/message.ts",
    "orchestrator/agent.ts",
    "orchestrator/tools.ts",
  ]

  for (const file of files) {
    const src = await fs.readFile(path.join(srcRoot, file), "utf8")
    expect(src).toContain('systemMode: "complete"')
  }

  const refineSrc = await fs.readFile(path.join(srcRoot, "orchestrator/tools.ts"), "utf8")
  expect(refineSrc).not.toContain('agent: "assistant"')

  const controlSrc = await fs.readFile(path.join(srcRoot, "control/message.ts"), "utf8")
  expect(controlSrc).toContain('const agent = "control"')
  expect(controlSrc).not.toContain('const agent = "general"')
})
