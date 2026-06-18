import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"
import { readSidecarHandshake } from "./sidecar-test-utils"

const CLI_TEST_DIR = import.meta.dir

describe("sidecar handshake test harness", () => {
  test("times out when stdout stays open and silent", async () => {
    const silentOpenStream = new ReadableStream<Uint8Array>({ start() {} })

    await expect(
      readSidecarHandshake(silentOpenStream, {
        idleTimeoutMs: 20,
        label: "silent sidecar fixture",
      }),
    ).rejects.toThrow(/silent sidecar fixture: timed out after 20ms of stdout inactivity waiting for OPENCORVUS_LISTEN/)
  })

  test("resets the timeout on stdout activity before the handshake arrives", async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        setTimeout(() => controller.enqueue(encoder.encode("booting\n")), 15)
        setTimeout(() => controller.enqueue(encoder.encode("still booting\n")), 35)
        setTimeout(() => controller.enqueue(encoder.encode("OPENCORVUS_LISTEN=127.0.0.1:4567\n")), 55)
      },
    })

    const handshake = await readSidecarHandshake(stream, {
      idleTimeoutMs: 30,
      label: "active sidecar fixture",
    })

    expect(handshake.port).toBe(4567)
    expect(handshake.stdout).toContain("still booting")
  })

  test("sidecar CLI tests use the bounded handshake helper instead of raw reader deadlines", () => {
    const files = ["sidecar-smoke.test.ts", "sidecar-chaos.test.ts", "sidecar-contention.test.ts"]
    const rawDeadlineRead = /while\s*\(\s*Date\.now\(\)\s*<\s*deadline\s*\)\s*\{[\s\S]*?await\s+reader\.read\(\)/

    for (const file of files) {
      const source = fs.readFileSync(path.join(CLI_TEST_DIR, file), "utf8")
      expect(source).toContain("readSidecarHandshake")
      expect(source).not.toMatch(rawDeadlineRead)
    }
  })

  test("source guard rejects the historical raw deadline reader shape", () => {
    const rawDeadlineRead = /while\s*\(\s*Date\.now\(\)\s*<\s*deadline\s*\)\s*\{[\s\S]*?await\s+reader\.read\(\)/
    const historicalSnippet = `
      const deadline = Date.now() + 30_000
      while (Date.now() < deadline) {
        const { done, value } = await reader.read()
        if (done) break
      }
    `

    expect(historicalSnippet).toMatch(rawDeadlineRead)
  })
})
