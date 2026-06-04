import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { Log } from "../../src/util/log"

test("Log writes Pino JSONL with structured error and timer fields", async () => {
  await Log.init({ print: false, dev: true, level: "DEBUG" })
  expect(Log.file()).toBe(path.join(Log.directory(), "dev.log"))
  const log = Log.create({ service: "log-pino-test" })
  const cause = new Error("inner failure")
  const error = new Error("outer failure", { cause })

  log.error("operation failed", { error, operation: "probe" })
  const timer = log.time("timed operation", { operation: "timer" })
  timer.stop()

  await Bun.sleep(50)
  const lines = readFileSync(Log.file(), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, any>)

  const failed = lines.find((line) => line.message === "operation failed")
  expect(failed).toMatchObject({
    level: "error",
    service: "log-pino-test",
    operation: "probe",
  })
  expect(failed?.error).toMatchObject({
    type: "Error",
    message: "outer failure: inner failure",
  })
  expect(String(failed?.error?.stack)).toContain("outer failure")

  const completed = lines.find((line) => line.message === "timed operation" && line.status === "completed")
  expect(completed).toMatchObject({
    level: "info",
    service: "log-pino-test",
    operation: "timer",
    status: "completed",
  })
  expect(typeof completed?.duration).toBe("number")
})
