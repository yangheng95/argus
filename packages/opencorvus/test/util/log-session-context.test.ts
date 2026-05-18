import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { Log } from "../../src/util/log"
import { SessionContext } from "../../src/session/context"
import type { Session } from "../../src/session"

function session(id: string): Session.Info {
  return {
    id,
    slug: "log-context",
    projectID: "project",
    directory: process.cwd(),
    title: "Log Context",
    version: "1.0.0",
    kind: "assistant",
    time: { created: 1, updated: 1 },
  }
}

test("logger tags non-session and session contexts from SessionContext", async () => {
  await Log.init({ print: false, dev: true, level: "DEBUG" })
  const log = Log.create({ service: "log-session-context" })
  const sessionID = `ses_log_${Date.now()}`

  log.info("outside")
  await SessionContext.provide(session(sessionID), async () => {
    log.info("inside")
  })

  await Bun.sleep(50)
  const raw = readFileSync(Log.file(), "utf8")
  const outside = raw.split("\n").find((line) => line.includes("outside")) ?? ""
  const inside = raw.split("\n").find((line) => line.includes("inside")) ?? ""

  expect(outside).toContain("logDomain=non-session")
  expect(outside).not.toContain("sessionID=")
  expect(inside).toContain("logDomain=session")
  expect(inside).toContain(`sessionID=${sessionID}`)
})
