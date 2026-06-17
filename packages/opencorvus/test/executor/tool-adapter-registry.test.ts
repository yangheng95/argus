import { describe, expect, test } from "bun:test"
import { ToolAdapterRegistry } from "../../src/executor/protocol"

describe("tool adapter registry", () => {
  test("classifies shell, structured output, and request_user_input tools", () => {
    expect(ToolAdapterRegistry.classify("Bash")?.id).toBe("shell")
    expect(ToolAdapterRegistry.classify("StructuredOutput")?.id).toBe("structured_output")
    expect(ToolAdapterRegistry.classify("request_user_input")?.id).toBe("request_user_input")
  })

  test("does not declare structured output without a concrete schema", async () => {
    const declared = await ToolAdapterRegistry.declare(
      ToolAdapterRegistry.context({
        provider: "codex",
        capabilities: {
          stream: true,
          resume: true,
          interrupt: true,
          builtin_tools: true,
          custom_tools: true,
          structured_output: true,
          approvals: ["command", "user_input"],
          reasoning: true,
          plan_updates: true,
          diff_updates: true,
          mcp: true,
          usage: true,
          realtime: true,
          tool_kinds: ["dynamic", "approval", "input", "shell", "structured_output"],
        },
      }),
    )

    expect(declared.some((item) => item.name === "shell_command")).toBe(true)
    expect(declared.some((item) => item.name === "structured_output")).toBe(false)
    expect(declared.some((item) => item.name === "request_user_input")).toBe(true)
  })

  test("declares structured output with the requested schema", async () => {
    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["summary"],
      properties: {
        summary: { type: "string", description: "Final concise summary." },
      },
    }

    const declared = await ToolAdapterRegistry.declare(
      ToolAdapterRegistry.context({
        provider: "codex",
        capabilities: {
          stream: true,
          resume: true,
          interrupt: true,
          builtin_tools: true,
          custom_tools: true,
          structured_output: true,
          approvals: ["command", "user_input"],
          reasoning: true,
          plan_updates: true,
          diff_updates: true,
          mcp: true,
          usage: true,
          realtime: true,
          tool_kinds: ["dynamic", "approval", "input", "shell", "structured_output"],
        },
        settings: {
          structured_output_schema: schema,
        },
      }),
    )

    expect(declared.find((item) => item.name === "structured_output")?.inputSchema).toEqual(schema)
  })
})
