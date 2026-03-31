import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { SessionActor } from "../../src/session/actor"
import { Message } from "../../src/session/message"
import { tmpdir } from "../fixture/fixture"

function assistant(sessionID: string, id: string): Message.WithParts {
  return {
    info: {
      id,
      sessionID,
      parentID: "msg_user",
      role: "assistant",
      mode: "build",
      agent: "build",
      path: {
        cwd: "",
        root: "",
      },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      modelID: "gpt-5.2",
      providerID: "openai",
      time: {
        created: Date.now(),
      },
    },
    parts: [],
  }
}

describe("session.actor", () => {
  test("resolves all current waiters with the same result", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "ses_actor_resolve"
        expect(SessionActor.start(sessionID)).toBeDefined()

        const one = SessionActor.wait(sessionID)
        const two = SessionActor.wait(sessionID)

        expect(await SessionActor.pending(sessionID)).toBe(2)

        const result = assistant(sessionID, "msg_actor_result")
        SessionActor.resolve(sessionID, result)

        await expect(one).resolves.toEqual(result)
        await expect(two).resolves.toEqual(result)

        SessionActor.cancel(sessionID)
      },
    })
  })

  test("rejects pending waiters on cancel", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "ses_actor_cancel"
        SessionActor.start(sessionID)

        const reply = SessionActor.wait(sessionID)
        expect(await SessionActor.pending(sessionID)).toBe(1)

        SessionActor.cancel(sessionID)

        await expect(reply).rejects.toThrow("Session cancelled")
        expect(await SessionActor.pending(sessionID)).toBe(0)
      },
    })
  })
})
