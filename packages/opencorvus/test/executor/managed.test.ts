import { afterEach, describe, expect, test } from "bun:test"
import type { CodingEventInfo, CodingProvider } from "../../src/executor/compat"
import { ExecutorRegistry } from "../../src/executor/registry"

describe("managed coding executor", () => {
  afterEach(() => {
    ExecutorRegistry.reset()
  })

  test("registerCoding adapts codex provider to executor contract", async () => {
    const provider: CodingProvider = {
      name: "codex",
      capabilities() {
        return {
          builtinTools: true,
          customTools: true,
          stream: true,
          resume: true,
          interrupt: true,
          cwd: true,
          system: true,
        }
      },
      async *run() {
        yield { type: "status", status: "created", meta: { id: "resp_1" } }
        yield { type: "text_delta", text: "Hello" }
        yield { type: "done", sessionID: "resp_1", output: "Hello world" }
      },
      async *resume() {},
      async interrupt() {
        return true
      },
    }

    const executor = ExecutorRegistry.registerCoding("codex", provider, {
      model: "gpt-5.2-codex",
      cwd: "/repo",
      system: "be concise",
    })

    const submitted = await executor.submit({
      sessionID: "session_1",
      prompt: "fix it",
    })

    const states = []
    for await (const item of executor.events({ sessionID: "session_1" })) {
      states.push(item.type)
    }

    const status = await executor.status(submitted.queueTaskID)
    const delivery = await executor.delivery({ sessionID: "session_1" })

    expect(status.status).toBe("completed")
    expect(delivery.summary).toBe("Hello world")
    expect(delivery.diffs).toEqual([])
    expect(states).toContain("executor.status")
    expect(states).toContain("message.part.delta")
    expect(states).toContain("session.idle")
  })

  test("registerCoding works without a hardcoded model", async () => {
    const seen: Array<string | undefined> = []
    const provider: CodingProvider = {
      name: "codex",
      capabilities() {
        return {
          builtinTools: true,
          customTools: true,
          stream: true,
          resume: true,
          interrupt: true,
          cwd: true,
          system: true,
        }
      },
      async *run(input) {
        seen.push(input.model)
        yield { type: "done", sessionID: "resp_2", output: "ok" }
      },
      async *resume() {},
      async interrupt() {
        return true
      },
    }

    const executor = ExecutorRegistry.registerCoding("codex", provider, {
      cwd: "/repo",
    })

    const submitted = await executor.submit({
      sessionID: "session_3",
      prompt: "hello",
    })
    let status = await executor.status(submitted.queueTaskID)
    for (let index = 0; index < 10 && status.status !== "completed"; index++) {
      await Bun.sleep(10)
      status = await executor.status(submitted.queueTaskID)
    }

    expect(status.status).toBe("completed")
    expect(seen).toEqual([undefined])
  })

  test("registerCoding forwards declared tools to the provider", async () => {
    const seen: unknown[] = []
    const provider: CodingProvider = {
      name: "codex",
      capabilities() {
        return {
          builtinTools: true,
          customTools: true,
          stream: true,
          resume: true,
          interrupt: true,
          cwd: true,
          system: true,
        }
      },
      async *run(input) {
        seen.push(input.tools)
        yield { type: "done", sessionID: "resp_tools", output: "ok" }
      },
      async *resume() {},
      async interrupt() {
        return true
      },
    }

    const executor = ExecutorRegistry.registerCoding("codex", provider, {
      cwd: "/repo",
      tools: [
        { type: "function", name: "shell_command", description: "run shell", inputSchema: { type: "object" } },
      ],
    })

    const submitted = await executor.submit({
      sessionID: "session_tools",
      prompt: "hello",
    })
    let status = await executor.status(submitted.queueTaskID)
    for (let index = 0; index < 10 && status.status !== "completed"; index++) {
      await Bun.sleep(10)
      status = await executor.status(submitted.queueTaskID)
    }

    expect(status.status).toBe("completed")
    expect(seen).toEqual([[
      {
        type: "function",
        name: "shell_command",
        description: "run shell",
        inputSchema: { type: "object" },
      },
    ]])
  })

  test("registerCoding adapts claude provider and supports abort", async () => {
    const stopped: string[] = []
    const interruptible: CodingProvider = {
      name: "claude-code",
      capabilities() {
        return {
          builtinTools: true,
          customTools: false,
          stream: true,
          resume: true,
          interrupt: true,
          cwd: true,
          system: true,
        }
      },
      async *run() {
        yield { type: "status", status: "init", meta: { session_id: "claude_1" } }
        yield { type: "text_delta", text: "A" }
        await Bun.sleep(5)
        yield { type: "done", sessionID: "claude_1", output: "done" }
      },
      async *resume() {},
      async interrupt(sessionID: string) {
        stopped.push(sessionID)
        return true
      },
    }

    const executor = ExecutorRegistry.registerCoding("claude-code", interruptible, {
      model: "claude-sonnet-4-5",
    })

    const submitted = await executor.submit({
      sessionID: "session_2",
      prompt: "check",
    })

    const aborted = await executor.abort({
      queueTaskID: submitted.queueTaskID,
    })
    const status = await executor.status(submitted.queueTaskID)

    expect(aborted).toBe(true)
    expect(status.status).toBe("failed")
    expect(status.error).toBe("task cancelled")
    expect(stopped).toEqual(["session_2"])
  })

  test("unexpected stream end is treated as failed instead of completed", async () => {
    const provider: CodingProvider = {
      name: "codex",
      capabilities() {
        return {
          builtinTools: true,
          customTools: true,
          stream: true,
          resume: true,
          interrupt: true,
          cwd: true,
          system: true,
        }
      },
      async *run() {
        yield { type: "status", status: "created", meta: { id: "resp_unexpected" } }
        yield { type: "text_delta", text: "partial output" }
      },
      async *resume() {},
      async interrupt() {
        return true
      },
    }

    const executor = ExecutorRegistry.registerCoding("codex", provider, {
      model: "gpt-5.2-codex",
    })

    const submitted = await executor.submit({
      sessionID: "session_unexpected",
      prompt: "keep going",
    })

    let status = await executor.status(submitted.queueTaskID)
    for (let index = 0; index < 10 && status.status !== "failed"; index++) {
      await Bun.sleep(10)
      status = await executor.status(submitted.queueTaskID)
    }

    expect(status.status).toBe("failed")
    expect(status.error).toBe("executor stream ended unexpectedly")
  })

  test("registerCoding exposes planning generation on the adapted executor", async () => {
    const seen: Array<Record<string, unknown>> = []
    const provider: CodingProvider = {
      name: "codex",
      capabilities() {
        return {
          builtinTools: true,
          customTools: true,
          stream: true,
          resume: true,
          interrupt: true,
          cwd: true,
          system: true,
        }
      },
      async *run(input) {
        seen.push(input as Record<string, unknown>)
        yield { type: "text_delta", text: "{\"summary\":\"ok\"" }
        yield { type: "done", sessionID: "resp_plan", output: "{\"summary\":\"ok\"}" }
      },
      async *resume() {},
      async interrupt() {
        return true
      },
    }

    const executor = ExecutorRegistry.registerCoding("codex", provider, {
      cwd: "/repo",
      system: "system",
      planning: {
        spec: true,
        plan: true,
      },
    })

    expect(executor.planningCapabilities?.()).toEqual({
      spec: true,
      plan: true,
    })

    const result = await executor.generatePlanning?.({
      stage: "spec",
      prompt: "spec",
      outputSchema: {
        type: "object",
        properties: {
          summary: { type: "string" },
        },
        required: ["summary"],
      },
    })

    expect(result?.output).toBe("{\"summary\":\"ok\"}")
    expect(seen[0]?.outputSchema).toEqual({
      type: "object",
      properties: {
        summary: { type: "string" },
      },
      required: ["summary"],
    })
  })

  test("planning generation keeps read-only sandbox without forcing no-tool mode", async () => {
    const seen: Record<string, unknown>[] = []
    const provider: CodingProvider = {
      name: "codex" as const,
      capabilities() {
        return {
          builtinTools: true,
          customTools: true,
          stream: true,
          resume: true,
          interrupt: true,
          cwd: true,
          system: true,
        }
      },
      async *run(input) {
        seen.push(input)
        yield {
          type: "done",
          output: "ok",
        } satisfies CodingEventInfo
      },
      async *resume() {},
      async interrupt() {
        return true
      },
    }

    const executor = ExecutorRegistry.registerCoding("codex", provider, {
      cwd: "/repo",
      tools: [
        { type: "function", name: "shell_command", description: "run shell", inputSchema: { type: "object" } },
      ],
      planning: {
        spec: true,
        plan: true,
      },
    })

    await executor.generatePlanning?.({
      stage: "spec",
      prompt: "spec",
    })

    expect(seen[0]).toMatchObject({
      sandbox: "read-only",
    })
    expect(seen[0]?.["toolMode"]).toBeUndefined()
    expect(seen[0]?.["tools"]).toBeUndefined()
  })
})
