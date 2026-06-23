import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { stopServerWithTimeout } from "../../src/server/stop"

const ROOT = resolve(import.meta.dir, "..", "..")

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8")
}

describe("serve shutdown lifecycle", () => {
  test("serve shutdown bounds server.stop before explicit process exit", () => {
    const serve = source("src/cli/cmd/serve.ts")
    const shutdownStart = serve.indexOf("const requestShutdown")
    const stopIndex = serve.indexOf("server.stop(true)", shutdownStart)
    const exitIndex = serve.indexOf("process.exit(0)", shutdownStart)
    const timeoutIndex = serve.indexOf("SERVE_STOP_TIMEOUT_MILLISECONDS", shutdownStart)
    const helperIndex = serve.indexOf("stopServerWithTimeout", shutdownStart)

    expect(shutdownStart).toBeGreaterThanOrEqual(0)
    expect(stopIndex).toBeGreaterThan(shutdownStart)
    expect(exitIndex).toBeGreaterThan(stopIndex)
    expect(timeoutIndex).toBeGreaterThan(shutdownStart)
    expect(helperIndex).toBeGreaterThan(shutdownStart)
    expect(helperIndex).toBeLessThan(exitIndex)
  })

  test("server stop helper captures synchronous stop failures", async () => {
    const errors: unknown[] = []
    let timeoutCalled = false

    await stopServerWithTimeout({
      stop: () => {
        throw new Error("sync stop failed")
      },
      timeoutMilliseconds: 1000,
      onStopError: (error) => {
        errors.push(error)
      },
      onTimeout: () => {
        timeoutCalled = true
      },
    })

    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(Error)
    expect(timeoutCalled).toBe(false)
  })

  test("server stop helper returns when stop never settles", async () => {
    let stopStarted = false
    let timeoutCalled = false

    await stopServerWithTimeout({
      stop: () =>
        new Promise<void>(() => {
          stopStarted = true
        }),
      timeoutMilliseconds: 5,
      onStopError: () => {
        throw new Error("stop should not fail in this scenario")
      },
      onTimeout: () => {
        timeoutCalled = true
      },
    })

    expect(stopStarted).toBe(true)
    expect(timeoutCalled).toBe(true)
  })
})
