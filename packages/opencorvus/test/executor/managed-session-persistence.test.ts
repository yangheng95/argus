import { afterEach, describe, expect, mock, test } from "bun:test"
import { ManagedCodingExecutor } from "../../src/executor/managed"
import type { CodingProvider } from "../../src/executor/contract"
import { Session } from "../../src/session"
import { Instance } from "../../src/project/instance"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

describe("managed executor session persistence", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("persists native provider session id from stream events", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant", title: "managed persistence" })
        const executor = ManagedCodingExecutor.create(providerWithRunRef("thr_1:turn_1"), {})

        await executor.submit({
          sessionID: session.id,
          prompt: "run",
        })

        await waitFor(() =>
          Session.get(session.id).then(
            (info) =>
              (info.metadata?.executor as { native_session_id?: string } | undefined)?.native_session_id ===
              "thr_1:turn_1",
          ),
        )

        const info = await Session.get(session.id)
        expect(info.metadata?.executor).toMatchObject({
          provider: "codex",
          native_session_id: "thr_1:turn_1",
        })
      },
    })
  })

  test("resumes with persisted native provider session id after adapter recreation", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant", title: "managed resume" })
        const first = ManagedCodingExecutor.create(providerWithRunRef("thr_2:turn_1"), {})
        await first.submit({
          sessionID: session.id,
          prompt: "run",
        })
        await waitFor(() =>
          Session.get(session.id).then(
            (info) =>
              (info.metadata?.executor as { native_session_id?: string } | undefined)?.native_session_id ===
              "thr_2:turn_1",
          ),
        )

        let resumedWith = ""
        const second = ManagedCodingExecutor.create(
          {
            name: "codex",
            capabilities: capabilities,
            async *run() {},
            async *resume(input) {
              resumedWith = input.sessionID
              yield { type: "done", sessionID: "thr_2:turn_2" }
            },
            async interrupt() {
              return false
            },
          },
          {},
        )

        await second.resume({
          sessionID: session.id,
          message: "continue",
        })
        await waitFor(() => Promise.resolve(resumedWith === "thr_2:turn_1"))

        expect(resumedWith).toBe("thr_2:turn_1")
      },
    })
  })

  test("does not reuse a native session id from a different provider", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant", title: "managed provider switch" })
        await ManagedCodingExecutor.create(providerWithRunRef("thr_old:turn_1"), {}).submit({
          sessionID: session.id,
          prompt: "run",
        })
        await waitFor(() =>
          Session.get(session.id).then(
            (info) =>
              (info.metadata?.executor as { native_session_id?: string } | undefined)?.native_session_id ===
              "thr_old:turn_1",
          ),
        )

        await ManagedCodingExecutor.create(
          {
            name: "claude-code",
            capabilities: capabilities,
            async *run() {
              yield { type: "done", sessionID: "claude_new" }
            },
            async *resume() {},
            async interrupt() {
              return false
            },
          },
          {},
        ).submit({
          sessionID: session.id,
          prompt: "run with different provider",
        })

        await waitFor(() =>
          Session.get(session.id).then(
            (info) =>
              (info.metadata?.executor as { native_session_id?: string } | undefined)?.native_session_id ===
              "claude_new",
          ),
        )
        const info = await Session.get(session.id)
        expect(info.metadata?.executor).toMatchObject({
          provider: "claude-code",
          native_session_id: "claude_new",
        })
      },
    })
  })

  test("resume rejects a persisted native session id from a different provider", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant", title: "managed resume provider switch" })
        await ManagedCodingExecutor.create(providerWithRunRef("thr_old:turn_1"), {}).submit({
          sessionID: session.id,
          prompt: "run",
        })
        await waitFor(() =>
          Session.get(session.id).then(
            (info) =>
              (info.metadata?.executor as { native_session_id?: string } | undefined)?.native_session_id ===
              "thr_old:turn_1",
          ),
        )

        let resumedWith = ""
        const executor = ManagedCodingExecutor.create(
          {
            name: "claude-code",
            capabilities: capabilities,
            async *run() {},
            async *resume(input) {
              resumedWith = input.sessionID
              yield { type: "done", sessionID: "claude_new" }
            },
            async interrupt() {
              return false
            },
          },
          {},
        )

        await expect(
          executor.resume({
            sessionID: session.id,
            message: "continue with different provider",
          }),
        ).rejects.toThrow("does not match claude-code")
        expect(resumedWith).toBe("")
      },
    })
  })
})

function providerWithRunRef(nativeSessionID: string): CodingProvider {
  return {
    name: "codex",
    capabilities,
    async *run() {
      yield {
        type: "progress",
        phase: "init",
        meta: {
          session_id: nativeSessionID,
        },
      }
      yield {
        type: "done",
        sessionID: nativeSessionID,
      }
    },
    async *resume() {},
    async interrupt() {
      return false
    },
  }
}

function capabilities() {
  return {
    builtinTools: true,
    customTools: true,
    stream: true,
    resume: true,
    interrupt: true,
    cwd: true,
    system: true,
  }
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 1000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return
    await Bun.sleep(10)
  }
  throw new Error("condition not met before timeout")
}
