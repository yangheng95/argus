import { afterEach, expect, mock, test } from "bun:test"
import { orchestratorState } from "../../src/orchestrator/helpers"
import { Instance } from "../../src/project/instance"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  mock.restore()
  await resetDatabase()
})

test("orchestrator state unsubscribes when the instance is disposed", async () => {
  await using tmp = await tmpdir()
  const unsub = mock()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const state = orchestratorState()
      state.booted = true
      state.syncing = true
      state.unsubscribe = unsub
      await Instance.dispose()
    },
  })

  expect(unsub).toHaveBeenCalledTimes(1)
})
