import { afterEach, test, expect } from "bun:test"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { SessionPromptState } from "../../src/session/prompt/state"
import { SessionStatus } from "../../src/session/status"
import { tmpdir } from "../fixture/fixture"

let unsubscribers: Array<() => void> = []

afterEach(async () => {
  for (const unsub of unsubscribers.splice(0)) unsub()
  await Instance.disposeAll()
})

test("prompt loop finish cleans state without publishing terminal aborted", async () => {
  await using tmp = await tmpdir({ git: true })
  const sessionID = "ses_prompt_finish_cleanup"
  const events: SessionStatus.Info[] = []

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      unsubscribers.push(
        Bus.subscribe(SessionStatus.Event.Status, (event) => {
          if (event.properties.sessionID === sessionID) events.push(event.properties.status)
        }),
      )

      const abort = SessionPromptState.start(sessionID)
      expect(abort).toBeDefined()
      SessionStatus.set(sessionID, { type: "streaming" })
      SessionPromptState.finish(sessionID, abort)
      SessionStatus.set(sessionID, { type: "terminal", reason: "completed" })
    },
  })

  expect(events).toEqual([{ type: "streaming" }, { type: "terminal", reason: "completed" }])
  expect(SessionStatus.get(sessionID)).toEqual({ type: "terminal", reason: "completed" })
})

test("prompt cancel remains the user cancellation terminal source", async () => {
  await using tmp = await tmpdir({ git: true })
  const sessionID = "ses_prompt_cancel_terminal"
  const events: SessionStatus.Info[] = []

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      unsubscribers.push(
        Bus.subscribe(SessionStatus.Event.Status, (event) => {
          if (event.properties.sessionID === sessionID) events.push(event.properties.status)
        }),
      )

      SessionPromptState.start(sessionID)
      SessionStatus.set(sessionID, { type: "streaming" })
      SessionPromptState.cancel(sessionID)
    },
  })

  expect(events).toEqual([{ type: "streaming" }, { type: "terminal", reason: "aborted" }])
  expect(SessionStatus.get(sessionID)).toEqual({ type: "terminal", reason: "aborted" })
})
