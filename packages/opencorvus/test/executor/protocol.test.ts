import { afterEach, describe, expect, test } from "bun:test"
import { protocolInfo } from "../../src/executor/protocol"

describe("executor protocol info", () => {
  afterEach(() => {
    delete process.env.OPENCORVUS_EXECUTOR_CODEX_PROTOCOL
  })

  test("reports codex app server capabilities when selected", () => {
    process.env.OPENCORVUS_EXECUTOR_CODEX_PROTOCOL = "app-server"
    const info = protocolInfo("codex")
    expect(info.protocol).toBe("codex-app-server")
    expect(info.version).toBe("v2")
    expect(info.capabilities.custom_tools).toBe(true)
    expect(info.capabilities.realtime).toBe(true)
    expect(info.capabilities.spec_generation).toBe(true)
    expect(info.capabilities.plan_generation).toBe(true)
  })

  test("reports codex cli capabilities when forced", () => {
    process.env.OPENCORVUS_EXECUTOR_CODEX_PROTOCOL = "cli"
    const info = protocolInfo("codex")
    expect(info.protocol).toBe("codex-cli-json")
    expect(info.version).toBe("v1")
    expect(info.capabilities.custom_tools).toBe(false)
    expect(info.capabilities.realtime).toBe(false)
  })

  test("reports codex app server capabilities by default", () => {
    const info = protocolInfo("codex")
    expect(info.protocol).toBe("codex-app-server")
    expect(info.version).toBe("v2")
    expect(info.capabilities.custom_tools).toBe(true)
  })

  test("reports claude agent sdk capabilities by default", () => {
    const info = protocolInfo("claude-code")
    expect(info.protocol).toBe("claude-agent-sdk")
    expect(info.transport.kind).toBe("inproc")
    expect(info.capabilities.structured_output).toBe(true)
    expect(info.capabilities.approvals).toEqual(["permission", "elicitation"])
    expect(info.capabilities.plan_generation).toBe(true)
  })
})
