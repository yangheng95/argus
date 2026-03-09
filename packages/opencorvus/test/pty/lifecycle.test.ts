import { describe, expect, test } from "bun:test"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { Pty } from "../../src/pty"
import { tmpdir } from "../fixture/fixture"

describe("pty lifecycle", () => {
  test("removes exited sessions without double delete", async () => {
    await using dir = await tmpdir({ git: true })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const events: string[] = []
        const unsubExited = Bus.subscribe(Pty.Event.Exited, (event) => events.push(`exited:${event.properties.id}`))
        const unsubDeleted = Bus.subscribe(Pty.Event.Deleted, (event) => events.push(`deleted:${event.properties.id}`))

        try {
          const session = await Pty.create({
            command: process.execPath,
            args: ["-e", "process.exit(0)"],
            title: "exit",
          })

          await Array.from({ length: 20 }).reduce(async (pending) => {
            await pending
            if (!Pty.get(session.id)) return
            await Bun.sleep(50)
          }, Promise.resolve())

          expect(Pty.get(session.id)).toBeUndefined()
          expect(events.filter((item) => item === `exited:${session.id}`)).toHaveLength(1)
          expect(events.filter((item) => item === `deleted:${session.id}`)).toHaveLength(1)

          await Pty.remove(session.id)

          expect(events.filter((item) => item === `deleted:${session.id}`)).toHaveLength(1)
        } finally {
          unsubExited()
          unsubDeleted()
        }
      },
    })
  })
})
