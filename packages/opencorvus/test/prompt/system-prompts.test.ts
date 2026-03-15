import { expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { SystemPrompt } from "../../src/session/system"
import { plannerSystem } from "../../src/planner/agent"
import { specSystem } from "../../src/spec/agent"
import { evaluatorSystem } from "../../src/evaluator/agent"
import { Agent } from "../../src/agent/agent"

test("system prompt overrides resolve from config", async () => {
  await using tmp = await tmpdir({
    config: {
      prompt: {
        core_header: "Custom core header",
        agent_generate: "Custom generator prompt",
        planner_system: "Custom planner prompt",
        spec_system: "Custom spec prompt",
        evaluator_system: "Custom evaluator prompt",
      },
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect(await SystemPrompt.instructions()).toBe("Custom core header")
      expect(await SystemPrompt.provider({} as never)).toEqual(["Custom core header"])
      expect(await Agent.generatePrompt()).toBe("Custom generator prompt")
      expect(await plannerSystem()).toBe("Custom planner prompt")
      expect(await specSystem()).toBe("Custom spec prompt")
      expect(await evaluatorSystem()).toBe("Custom evaluator prompt")
    },
  })
})
