import { describe, expect, test } from "bun:test"
import path from "node:path"

const sourceRoot = path.resolve(import.meta.dir, "../../src")
const source = await Bun.file(path.join(sourceRoot, "util/process-error-logging.ts")).text()
const cliSource = await Bun.file(path.join(sourceRoot, "index.ts")).text()
const overlayServerSource = await Bun.file(path.join(sourceRoot, "overlay-server.ts")).text()

describe("process error logging", () => {
  test("process-level failures keep structured Error objects", () => {
    expect(source).toContain('Log.Default.error("unhandled rejection", errorPayload(reason))')
    expect(source).toContain('Log.Default.error("uncaught exception", errorPayload(error))')
    expect(source).toContain("reason instanceof Error ? { error: reason } : { reason }")
    expect(source).not.toContain("e instanceof Error ? e.message")
  })

  test("process-level failures rethrow after logging so the runtime owns fatal exit semantics", () => {
    expect(source).toContain('process.removeAllListeners(event)')
    expect(source).toContain("throw reason")
    expect(source).toContain('rethrowAfterProcessError("unhandledRejection", reason)')
    expect(source).toContain('rethrowAfterProcessError("uncaughtException", error)')
    expect(source).not.toContain("setTimeout(() => process.exit")
  })

  test("CLI entrypoints use the shared process error logger", () => {
    expect(cliSource).toContain("installProcessErrorLogging()")
    expect(overlayServerSource).toContain("installProcessErrorLogging()")
    expect(cliSource).not.toContain('Log.Default.error("rejection"')
    expect(overlayServerSource).not.toContain('Log.Default.error("exception"')
  })
})
