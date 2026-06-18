import { describe, expect, test } from "bun:test"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionLoop } from "../../src/session/loop"
import { AgentRuntimeMetadata } from "../../src/session/agent-runtime-metadata"

describe("session runtime contract tool surface", () => {
  void SessionPrompt

  test("worker runtime metadata covers current runAgentSession stage agents", () => {
    expect(AgentRuntimeMetadata.AGENT_OWNED_SESSION_KIND_SET.has("visual-qa")).toBe(true)
    expect(SessionLoop.agentKindRequiresRuntimeContract("visual-qa")).toBe(true)
    expect(SessionLoop.agentKindRequiresRuntimeContract("explore")).toBe(true)
    expect(SessionLoop.agentKindRequiresRuntimeContract("goal-workload-analyst")).toBe(true)
    expect(AgentRuntimeMetadata.EXACT_RUNTIME_CONTRACT_AGENT_KIND_SET.has("visual-qa")).toBe(true)
    expect(AgentRuntimeMetadata.EXACT_RUNTIME_CONTRACT_AGENT_KIND_SET.has("explore")).toBe(false)
    expect(AgentRuntimeMetadata.EXACT_RUNTIME_CONTRACT_AGENT_KIND_SET.has("goal-workload-analyst")).toBe(true)
    expect(AgentRuntimeMetadata.EXACT_RUNTIME_CONTRACT_AGENT_KIND_SET.has("deep-research")).toBe(true)
    expect(AgentRuntimeMetadata.EXACT_RUNTIME_CONTRACT_AGENT_KIND_SET.has("fact-check")).toBe(true)
    expect(AgentRuntimeMetadata.EXACT_RUNTIME_CONTRACT_AGENT_KIND_SET.has("research" as never)).toBe(false)
  })

  test("exact runtime contract still requires matching agent identity", () => {
    const contract = {
      identity: {
        sessionID: "ses_visual_qa_exact",
        agentKind: "visual-qa",
        contractKind: "stage-attempt",
      },
      tools: {},
    } as SessionLoop.SessionRuntimeContract

    expect(SessionLoop.usesExactRuntimeContractTools("visual-qa", contract)).toBe(true)
    expect(SessionLoop.usesExactRuntimeContractTools("goal-workload-analyst", contract)).toBe(false)
  })
})
