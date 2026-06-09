import { describe, expect, test } from "bun:test"
import { HandshakeBuffer, parseHandshakeLine, startInactivityWatchdog } from "../src/sidecar/handshake"
import { SidecarHandshakeTimeoutError } from "../src/sidecar/errors"

describe("parseHandshakeLine", () => {
  test("parses canonical handshake line", () => {
    expect(parseHandshakeLine("OPENCORVUS_LISTEN=127.0.0.1:54321")).toEqual({
      hostname: "127.0.0.1",
      port: 54321,
    })
  })

  test("tolerates trailing whitespace and CRLF", () => {
    expect(parseHandshakeLine("OPENCORVUS_LISTEN=127.0.0.1:1234\r")).toEqual({
      hostname: "127.0.0.1",
      port: 1234,
    })
  })

  test("rejects unrelated stdout noise", () => {
    expect(parseHandshakeLine("opencorvus server listening on http://...")).toBeNull()
    expect(parseHandshakeLine("")).toBeNull()
    expect(parseHandshakeLine("OPENCORVUS_LISTEN=invalid")).toBeNull()
  })

  test("rejects out-of-range ports", () => {
    expect(parseHandshakeLine("OPENCORVUS_LISTEN=127.0.0.1:0")).toBeNull()
    expect(parseHandshakeLine("OPENCORVUS_LISTEN=127.0.0.1:65536")).toBeNull()
    expect(parseHandshakeLine("OPENCORVUS_LISTEN=127.0.0.1:-1")).toBeNull()
  })
})

describe("HandshakeBuffer", () => {
  test("returns null until a complete matching line is seen", () => {
    const buf = new HandshakeBuffer()
    expect(buf.push("OPEN")).toBeNull()
    expect(buf.push("CORVUS_LISTEN=127.0.0.1:9999")).toBeNull()
    expect(buf.push("\n")).toEqual({ hostname: "127.0.0.1", port: 9999 })
  })

  test("ignores noise lines preceding the handshake", () => {
    const buf = new HandshakeBuffer()
    expect(buf.push("starting up\n")).toBeNull()
    expect(buf.push("loading config\n")).toBeNull()
    expect(buf.push("OPENCORVUS_LISTEN=127.0.0.1:7777\n")).toEqual({
      hostname: "127.0.0.1",
      port: 7777,
    })
  })

  test("returns the same handshake on subsequent pushes (idempotent)", () => {
    const buf = new HandshakeBuffer()
    const first = buf.push("OPENCORVUS_LISTEN=127.0.0.1:1234\n")
    const second = buf.push("more noise after\n")
    expect(first).toEqual({ hostname: "127.0.0.1", port: 1234 })
    expect(second).toEqual({ hostname: "127.0.0.1", port: 1234 })
  })
})

describe("startInactivityWatchdog", () => {
  test("fires onTimeout when no touch happens before idleMs", async () => {
    let fired: SidecarHandshakeTimeoutError | undefined
    const wd = startInactivityWatchdog({
      idleMs: 50,
      stderrTailRef: () => "stderr-tail-sample",
      onTimeout: (e) => {
        fired = e as SidecarHandshakeTimeoutError
      },
    })
    await new Promise((r) => setTimeout(r, 150))
    wd.cancel()
    expect(fired).toBeInstanceOf(SidecarHandshakeTimeoutError)
    expect(fired?.stderrTail).toBe("stderr-tail-sample")
  })

  test("touch() defers the timeout", async () => {
    let fired = 0
    const wd = startInactivityWatchdog({
      idleMs: 80,
      stderrTailRef: () => "",
      onTimeout: () => {
        fired++
      },
    })
    await new Promise((r) => setTimeout(r, 50))
    wd.touch()
    await new Promise((r) => setTimeout(r, 50))
    wd.touch()
    await new Promise((r) => setTimeout(r, 50))
    expect(fired).toBe(0)
    wd.cancel()
  })

  test("cancel() suppresses subsequent timeouts", async () => {
    let fired = 0
    const wd = startInactivityWatchdog({
      idleMs: 30,
      stderrTailRef: () => "",
      onTimeout: () => {
        fired++
      },
    })
    wd.cancel()
    await new Promise((r) => setTimeout(r, 100))
    expect(fired).toBe(0)
  })
})
