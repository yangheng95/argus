import { afterEach, describe, expect, test } from "bun:test"
import { ClaudeCodeExecutor } from "../../src/executor/claude-code"
import { CodexExecutor } from "../../src/executor/codex"
import type { CodingEventInfo, CodingProvider } from "../../src/executor/contract"
import { ExecutorRegistry } from "../../src/executor/registry"

function feed(items: unknown[], wait = 0): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) {
        if (wait > 0) await Bun.sleep(wait)
        yield item
      }
    },
  }
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await Bun.sleep(10)
  }
  throw new Error("timed out waiting for condition")
}

describe("managed coding executor", () => {
  afterEach(() => {
    ExecutorRegistry.reset()
  })

  test("registerCoding works without a hardcoded model", async () => {
    const seen: Array<string | undefined> = []
    const provider = {
      ...CodexExecutor.create({
        responses: {
          create(input: Record<string, unknown>) {
            seen.push(typeof input.model === "string" ? input.model : undefined)
            return feed([{ type: "response.completed", response: { id: "resp_2", output_text: "ok" } }])
          },
        },
      }),
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
    const provider = {
      ...CodexExecutor.create({
        responses: {
          create(input: Record<string, unknown>) {
            seen.push(input.tools)
            return feed([{ type: "response.completed", response: { id: "resp_tools", output_text: "ok" } }])
          },
        },
      }),
    }

    const executor = ExecutorRegistry.registerCoding("codex", provider, {
      cwd: "/repo",
      tools: [{ type: "function", name: "shell_command", description: "run shell", inputSchema: { type: "object" } }],
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
    expect(seen).toEqual([
      [
        {
          type: "function",
          name: "shell_command",
          description: "run shell",
          parameters: { type: "object" },
        },
      ],
    ])
  })

  test("registerCoding preserves provider options for direct external dispatch", () => {
    const provider = CodexExecutor.create({
      responses: {
        create() {
          return feed([])
        },
      },
    })
    const tools = [
      { type: "function" as const, name: "shell_command", description: "run shell", inputSchema: { type: "object" } },
    ]

    ExecutorRegistry.registerCoding("codex", provider, {
      cwd: "/repo",
      tools: () => tools,
    })

    const registration = ExecutorRegistry.requireCoding("codex")
    expect(registration.provider).toBe(provider)
    expect(typeof registration.options.tools).toBe("function")
    expect((registration.options.tools as () => typeof tools)()).toBe(tools)

    ExecutorRegistry.reset()
    expect(() => ExecutorRegistry.requireCoding("codex")).toThrow()
  })

  test("registerCoding adapts claude provider and supports abort", async () => {
    const stopped: string[] = []
    const provider = ClaudeCodeExecutor.create(() =>
      feed(
        [
          { type: "system", subtype: "init", session_id: "claude_1" },
          {
            type: "stream_event",
            event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "A" } },
          },
          { type: "result", subtype: "success", session_id: "claude_1", result: "done" },
        ],
        5,
      ),
    )
    const interruptible = {
      ...provider,
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

  test("abort returns promptly when provider interrupt never settles", async () => {
    let interruptCalled = false
    const provider: CodingProvider = {
      name: "codex",
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
      run() {
        let index = 0
        return {
          [Symbol.asyncIterator]() {
            return {
              next: async () => {
                if (index++ === 0) {
                  return {
                    done: false,
                    value: {
                      type: "progress",
                      phase: "init",
                      summary: "started",
                      meta: { session_id: "native_hung_interrupt" },
                    } satisfies CodingEventInfo,
                  }
                }
                return new Promise<IteratorResult<CodingEventInfo>>(() => {})
              },
              return: async () => ({ done: true, value: undefined as any }),
            }
          },
        }
      },
      resume() {
        return feed([]) as AsyncIterable<CodingEventInfo>
      },
      interrupt() {
        interruptCalled = true
        return new Promise<boolean>(() => {})
      },
    }

    const executor = ExecutorRegistry.registerCoding("codex", provider, { cwd: "/repo" })
    const submitted = await executor.submit({ sessionID: "session_hung_interrupt", prompt: "work" })
    await waitFor(async () => {
      const status = await executor.status(submitted.queueTaskID)
      return status.status === "running"
    })

    const started = Date.now()
    const aborted = await executor.abort({ queueTaskID: submitted.queueTaskID })
    const elapsed = Date.now() - started
    const status = await executor.status(submitted.queueTaskID)

    expect(aborted).toBe(true)
    expect(interruptCalled).toBe(true)
    expect(elapsed).toBeLessThan(500)
    expect(status.status).toBe("failed")
    expect(status.error).toBe("task cancelled")
  })

  test("abort unwinds a parked provider iterator and completes event consumers", async () => {
    let returned = false
    const provider: CodingProvider = {
      name: "codex",
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
      run() {
        let index = 0
        return {
          [Symbol.asyncIterator]() {
            return {
              next: async () => {
                if (index++ === 0) {
                  return {
                    done: false,
                    value: {
                      type: "progress",
                      phase: "init",
                      summary: "started",
                      meta: { session_id: "native_parked" },
                    } satisfies CodingEventInfo,
                  }
                }
                return new Promise<IteratorResult<CodingEventInfo>>(() => {})
              },
              return: async () => {
                returned = true
                return { done: true, value: undefined as any }
              },
            }
          },
        }
      },
      resume() {
        return feed([]) as AsyncIterable<CodingEventInfo>
      },
      async interrupt() {
        return true
      },
    }

    const executor = ExecutorRegistry.registerCoding("codex", provider, { cwd: "/repo" })
    const submitted = await executor.submit({ sessionID: "session_parked", prompt: "work" })
    const events = (async () => {
      const seen: string[] = []
      for await (const event of executor.events!({ queueTaskID: submitted.queueTaskID })) {
        seen.push(event.type)
      }
      return seen
    })()
    await waitFor(async () => {
      const status = await executor.status(submitted.queueTaskID)
      return status.status === "running"
    })

    await executor.abort({ queueTaskID: submitted.queueTaskID })
    const seen = await Promise.race([
      events,
      Bun.sleep(1_000).then(() => {
        throw new Error("managed event consumer did not complete")
      }),
    ])

    expect(returned).toBe(true)
    expect(seen).toContain("session.error")
  })

  test("registerCoding exposes planning generation on the adapted executor", async () => {
    const provider = CodexExecutor.create({
      responses: {
        create() {
          return feed([
            { type: "response.output_text.delta", delta: '{"summary":"ok"' },
            { type: "response.completed", response: { id: "resp_plan", output_text: '{"summary":"ok"}' } },
          ])
        },
      },
    })

    const executor = ExecutorRegistry.registerCoding("codex", provider, {
      cwd: "/repo",
      system: "system",
    })

    expect(executor.planningCapabilities?.()).toEqual({
      spec: true,
      plan: true,
    })

    const result = await executor.generatePlanning?.({
      stage: "spec",
      prompt: "spec",
    })

    expect(result?.output).toBe('{"summary":"ok"}')
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
      tools: [{ type: "function", name: "shell_command", description: "run shell", inputSchema: { type: "object" } }],
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
