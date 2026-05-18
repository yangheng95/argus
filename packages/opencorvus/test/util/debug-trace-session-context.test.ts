import { expect, test } from "bun:test"

function runTrace(script: string): string {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "-e", script],
    cwd: process.cwd(),
    env: {
      ...process.env,
      OPENCORVUS_BUS_DISPATCH_TRACE: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  expect(result.exitCode).toBe(0)
  return new TextDecoder().decode(result.stderr)
}

test("debug trace tags non-session domain without ambient session", () => {
  const stderr = runTrace(`
    const { traceBus } = await import("./src/util/debug-trace.ts")
    traceBus({ event: "phase6" })
  `)

  expect(stderr).toContain("[bus-dispatch-trace]")
  expect(stderr).toContain('domain="non-session"')
  expect(stderr).not.toContain("sessionID=")
})

test("debug trace tags session bucket from bound SessionContext reader", () => {
  const stderr = runTrace(`
    const { SessionObservability } = await import("./src/util/session-observability.ts")
    SessionObservability.bindSessionContext(() => ({ id: "ses_debug_trace" }))
    const { traceBus } = await import("./src/util/debug-trace.ts")
    traceBus({ event: "phase6" })
  `)

  expect(stderr).toContain("[bus-dispatch-trace]")
  expect(stderr).toContain('domain="session"')
  expect(stderr).toContain('sessionID="ses_debug_trace"')
})
