import { describe, expect, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { SessionAgentIdentity } from "../../src/session/agent-identity"

describe("resolveSessionAgent (Phase 4)", () => {
  test("agent-owned stage sessions resolve from the session kind metadata", () => {
    expect(SessionAgentIdentity.ownedAgentForSessionKind("visual-qa")).toBe("visual-qa")
    expect(SessionAgentIdentity.ownedAgentForSessionKind("goal-workload-analyst")).toBe("goal-workload-analyst")
    expect(SessionAgentIdentity.ownedAgentForSessionKind("assistant")).toBeUndefined()
  })

  test("applies prompt and runtime knob overlay without mutating base agent", () => {
    const base = {
      name: "coding",
      mode: "primary",
      native: true,
      options: {},
      prompt: "base prompt",
      promptAppend: "base append",
      temperature: 0.1,
      topP: 0.2,
    } as Agent.Info

    const effective = Agent.resolveSessionAgent(base, {
      agent: {
        coding: {
          prompt: "session prompt",
          prompt_append: "session append",
          temperature: 0.7,
          top_p: 0.8,
        },
      },
    })

    expect(effective.prompt).toBe("session prompt")
    expect(effective.promptAppend).toBe("session append")
    expect(effective.temperature).toBe(0.7)
    expect(effective.topP).toBe(0.8)
    expect(base.prompt).toBe("base prompt")
    expect(base.temperature).toBe(0.1)
  })
})
