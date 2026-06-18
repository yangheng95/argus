import { afterEach, describe, expect, test } from "bun:test"
import { Bus } from "../../src/bus"
import { PermissionNext } from "../../src/permission/next"
import { Instance } from "../../src/project/instance"
import { Question } from "../../src/question"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("question and permission routes", () => {
  afterEach(async () => {
    Server.resetProjectRoutesAppForTest()
    await resetDatabase()
  })

  async function requestWithReplyEventLog(
    directory: string,
    path: string,
    body: unknown,
  ): Promise<{ response: Response; events: string[] }> {
    return Instance.provide({
      directory,
      async fn() {
        const events: string[] = []
        const unsubscribe = [
          Bus.subscribe(Question.Event.Replied, (event) => events.push(event.type)),
          Bus.subscribe(Question.Event.Rejected, (event) => events.push(event.type)),
          Bus.subscribe(PermissionNext.Event.Replied, (event) => events.push(event.type)),
        ]
        try {
          const response = await Server.App().request(path, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-opencorvus-directory": directory,
            },
            body: JSON.stringify(body),
          })
          return { response, events }
        } finally {
          for (const unsub of unsubscribe) unsub()
        }
      },
    })
  }

  test("question reply for unknown request returns 404 and emits no reply event", async () => {
    await using tmp = await tmpdir({ git: true })

    const { response, events } = await requestWithReplyEventLog(tmp.path, "/question/que_missing/reply", {
      answers: [["Option 1"]],
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ name: "NotFoundError" })
    expect(events).toEqual([])
  })

  test("question reject for unknown request returns 404 and emits no reject event", async () => {
    await using tmp = await tmpdir({ git: true })

    const { response, events } = await requestWithReplyEventLog(tmp.path, "/question/que_missing/reject", {})

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ name: "NotFoundError" })
    expect(events).toEqual([])
  })

  test("permission reply for unknown request returns 404 and emits no reply event", async () => {
    await using tmp = await tmpdir({ git: true })

    const { response, events } = await requestWithReplyEventLog(tmp.path, "/permission/per_missing/reply", {
      reply: "once",
      autoReply: false,
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ name: "NotFoundError" })
    expect(events).toEqual([])
  })
})
