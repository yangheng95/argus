import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import type { Agent } from "../../src/agent/agent"
import { LLM } from "../../src/session/llm"
import type { Message } from "../../src/session/message"
import type { Provider } from "../../src/provider/provider"
import { applyRightSidebarCodingAssistantPromptOverlay } from "../../src/coding-assistant/session"
import BUILD_CORE from "../../src/prompt/core/build-core.txt"
import PROMPT_CODING from "../../src/agent/prompt/coding.txt"
import { Instance } from "../../src/project/instance"
import { PROJECT_EXPERT_SQUAD_ID, writeProjectExpertSquadPackage } from "../fixture/expert-squad"
import { tmpdir } from "../fixture/fixture"

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

test("direct coding uses the coding prompt while build stage uses complete core", async () => {
  const coding = {
    name: "coding",
    mode: "primary",
    prompt: PROMPT_CODING,
  } as Agent.Info
  const codingSystem = await LLM.composeSystem({
    agent: coding,
    model,
    system: [],
    user: {
      ...user(),
      agent: "coding",
      system: undefined,
    } as Message.User,
  })

  expect(codingSystem).toEqual([PROMPT_CODING])

  const build = {
    name: "build",
    mode: "primary",
    prompt: BUILD_CORE,
  } as Agent.Info
  const buildSystem = await LLM.composeSystem({
    agent: build,
    model,
    system: ["RUNNER RUNTIME CONTEXT"],
    user: {
      ...user("complete"),
      agent: "build",
      system: BUILD_CORE,
    } as Message.User,
  })

  expect(buildSystem).toEqual([`RUNNER RUNTIME CONTEXT\n${BUILD_CORE}`])
})

test("direct LLM composition applies project package prompt overlays when an Instance context exists", async () => {
  await using tmp = await tmpdir({
    git: true,
    config: { prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } },
  })
  await writeProjectExpertSquadPackage(tmp.path)

  const build = {
    name: "build",
    mode: "primary",
    prompt: BUILD_CORE,
  } as Agent.Info

  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const system = await LLM.composeSystem({
          agent: build,
          model,
          system: [],
          user: {
            ...user(),
            agent: "build",
            system: undefined,
          } as Message.User,
        })

        expect(system[0]).toContain(BUILD_CORE)
        expect(system[0]).toContain("project build overlay")
        expect(system[0].indexOf(BUILD_CORE)).toBeLessThan(system[0].indexOf("project build overlay"))
      },
    })
  } finally {
    await Instance.disposeAll()
  }
})

test("right sidebar coding assistant overlay prevents complete-system prompt replacement", async () => {
  const codingAssistant = {
    name: "coding-assistant",
    mode: "primary",
    prompt: PROMPT_CODING,
  } as Agent.Info
  const overlaid = applyRightSidebarCodingAssistantPromptOverlay({
    agent: "mission",
    system: "MALICIOUS COMPLETE SYSTEM",
    systemMode: "complete" as const,
    tools: { panel: false, question: false, bash: false, edit: false },
    parts: [{ type: "text" as const, text: "hello" }],
  })

  const system = await LLM.composeSystem({
    agent: codingAssistant,
    model,
    system: [],
    user: {
      ...user(overlaid.systemMode),
      agent: overlaid.agent,
      system: overlaid.system,
      tools: overlaid.tools,
    } as Message.User,
  })

  expect(overlaid.agent).toBe("coding-assistant")
  expect(overlaid.system).toBeUndefined()
  expect(overlaid.systemMode).toBeUndefined()
  expect(system).toEqual([PROMPT_CODING])
})

test("runtime prompt call sites mark complete system prompts explicitly", async () => {
  const srcRoot = path.join(import.meta.dir, "..", "..", "src")
  const files = ["agent/runner.ts", "control/message.ts", "orchestrator/agent.ts", "orchestrator/tools.ts"]

  for (const file of files) {
    const src = await fs.readFile(path.join(srcRoot, file), "utf8")
    expect(src).toContain('systemMode: "complete"')
  }

  const refineSrc = await fs.readFile(path.join(srcRoot, "orchestrator/tools.ts"), "utf8")
  expect(refineSrc).not.toContain('agent: "assistant"')
  expect(refineSrc).toContain("RefineResultSchema")
  expect(refineSrc).toContain('type: "json_schema"')
  expect(refineSrc).not.toContain("JSON.parse(resultText.trim())")

  const controlSrc = await fs.readFile(path.join(srcRoot, "control/message.ts"), "utf8")
  expect(controlSrc).toContain('const agent = "control"')
  expect(controlSrc).not.toContain('const agent = "general"')
  expect(controlSrc).not.toContain("parseTextAsResult")
})
