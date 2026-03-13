import { describe, expect, test } from "bun:test"
import { protocolInfo } from "../../src/executor/protocol"

describe("executor protocol info", () => {
  test("reports codex app server capabilities", () => {
    const info = protocolInfo("codex")
    expect(info.protocol).toBe("codex-app-server")
    expect(info.version).toBe("v2")
    expect(info.capabilities.custom_tools).toBe(false)
    expect(info.capabilities.structured_output).toBe(true)
    expect(info.capabilities.realtime).toBe(true)
    expect(info.capabilities.spec_generation).toBe(true)
    expect(info.capabilities.plan_generation).toBe(true)
  })

  test("reports claude agent sdk capabilities by default", () => {
    const info = protocolInfo("claude-code")
    expect(info.protocol).toBe("claude-agent-sdk")
    expect(info.transport.kind).toBe("inproc")
    expect(info.capabilities.custom_tools).toBe(false)
    expect(info.capabilities.structured_output).toBe(true)
    expect(info.capabilities.approvals).toEqual(["permission", "elicitation"])
    expect(info.capabilities.spec_generation).toBe(false)
    expect(info.capabilities.plan_generation).toBe(false)
  })
})
