import { afterEach, describe, expect, mock, test } from "bun:test"
import fs from "fs"
import path from "path"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const sdkCalls: string[] = []
const clientOptions: unknown[] = []

const fakeSdk = {
  session: {
    async list() {
      sdkCalls.push("session.list")
      return { data: [] }
    },
    async fork() {
      sdkCalls.push("session.fork")
      return { data: { id: "forked-session" } }
    },
    async create() {
      sdkCalls.push("session.create")
      return { data: { id: "created-session" } }
    },
    async command() {
      sdkCalls.push("session.command")
      return { data: {} }
    },
    async prompt() {
      sdkCalls.push("session.prompt")
      return { data: {} }
    },
  },
  event: {
    async subscribe() {
      sdkCalls.push("event.subscribe")
      return {
        stream: (async function* () {})(),
      }
    },
  },
}

mock.module("@opencorvus-ai/sdk", () => ({
  createOpenCorvusClient(options: unknown) {
    clientOptions.push(options)
    return fakeSdk
  },
}))

type RunModule = typeof import("../../src/cli/cmd/run")
let runModulePromise: Promise<RunModule> | undefined

async function runModule(): Promise<RunModule> {
  runModulePromise ??= import("../../src/cli/cmd/run")
  return runModulePromise
}

afterEach(async () => {
  sdkCalls.length = 0
  clientOptions.length = 0
  Config.global.reset()
  await Instance.disposeAll()
})

async function withProject<T>(fn: () => Promise<T>): Promise<T> {
  await using tmp = await tmpdir()
  return Instance.provide({
    directory: tmp.path,
    fn,
  })
}

async function withInteractiveStdin<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.stdin.isTTY
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true })
  try {
    return await fn()
  } finally {
    Object.defineProperty(process.stdin, "isTTY", { value: previous, configurable: true })
  }
}

function runArgs(overrides: Record<string, unknown>) {
  return {
    message: ["hello"],
    "--": [],
    command: undefined,
    continue: false,
    session: undefined,
    fork: false,
    share: false,
    model: undefined,
    agent: undefined,
    format: "default",
    file: undefined,
    title: undefined,
    attach: "http://127.0.0.1:9",
    dir: undefined,
    port: undefined,
    variant: undefined,
    thinking: false,
    ...overrides,
  }
}

async function expectRunRejectsBeforeSession(overrides: Record<string, unknown>, message: string) {
  const { RunCommand } = await runModule()
  const handler = RunCommand.handler
  if (!handler) throw new Error("RunCommand handler missing")

  await withProject(async () => {
    await withInteractiveStdin(async () => {
      await expect(handler(runArgs(overrides) as never)).rejects.toThrow(message)
    })
  })

  expect(clientOptions).toHaveLength(1)
  expect(sdkCalls).toEqual([])
}

describe("run command agent selection", () => {
  test("keeps implicit default only when no explicit agent is provided", async () => {
    const { resolveRunAgent } = await runModule()
    await expect(resolveRunAgent(undefined)).resolves.toBeUndefined()
  })

  test("rejects missing explicit agents", async () => {
    const { resolveRunAgent } = await runModule()
    await withProject(async () => {
      await expect(resolveRunAgent("missing-agent")).rejects.toThrow('agent "missing-agent" not found')
    })
  })

  test("rejects explicit subagents", async () => {
    const { resolveRunAgent } = await runModule()
    await withProject(async () => {
      await expect(resolveRunAgent("explore")).rejects.toThrow(
        'agent "explore" is a subagent, not a primary agent',
      )
    })
  })

  test("accepts explicit primary agents", async () => {
    const { resolveRunAgent } = await runModule()
    await withProject(async () => {
      await expect(resolveRunAgent("coding")).resolves.toBe("coding")
    })
  })

  test("handler rejects missing prompt agents before session side effects", async () => {
    await expectRunRejectsBeforeSession({ agent: "missing-agent" }, 'agent "missing-agent" not found')
  })

  test("handler rejects subagent command agents before session side effects", async () => {
    await expectRunRejectsBeforeSession(
      { agent: "explore", command: "echo" },
      'agent "explore" is a subagent, not a primary agent',
    )
  })

  test("validates explicit agent before creating or prompting a session", () => {
    const source = fs.readFileSync(path.resolve(import.meta.dir, "../../src/cli/cmd/run.ts"), "utf8")

    expect(source).not.toContain("Falling back to default agent")

    const validationIndex = source.indexOf("const agent = await resolveRunAgent(args.agent)")
    const sessionIndex = source.indexOf("const sessionID = await session(sdk)")
    const commandIndex = source.indexOf("await sdk.session.command")
    const promptIndex = source.indexOf("await sdk.session.prompt")

    expect(validationIndex).toBeGreaterThanOrEqual(0)
    expect(sessionIndex).toBeGreaterThan(validationIndex)
    expect(commandIndex).toBeGreaterThan(sessionIndex)
    expect(promptIndex).toBeGreaterThan(sessionIndex)
  })
})
