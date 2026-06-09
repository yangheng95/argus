import { afterEach, describe, expect, test } from "bun:test"
import { __setFileReaderFactoryForTest, fileToDataUrl, type FileReaderLike } from "../src/services/file-to-data-url"

/**
 * audit-2026-04-29 W2-V18 — FileReader rejection contract.
 *
 * Pre-fix the file-input / drop / paste loops in ChatComposer ran
 *   for (const file of files) await addAttachment(file)
 * where `addAttachment` did `const url = await fileToDataUrl(file)`
 * with NO try/catch. A FileReader rejection (file deleted mid-read,
 * EACCES, browser quota) propagated as a throw out of
 * addAttachment, ABORTING the loop. Subsequent files in the same
 * drag never got processed and the user saw no error feedback.
 *
 * Post-fix:
 *   - fileToDataUrl is extracted so its rejection behaviour is
 *     unit-testable via a FileReader factory override (Bun has no
 *     jsdom).
 *   - addAttachment wraps the await in try/catch + native toast +
 *     `return` (no throw), so the for-of loop continues to the
 *     next file. (Tested at the integration level by ChatComposer
 *     E2E in a future milestone.)
 *
 * This file locks the contract that fileToDataUrl REJECTS the
 * Promise (not hangs, not resolves with empty) on FileReader
 * onerror, so the catch is the consumer's only obligation.
 */

class FakeReader implements FileReaderLike {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  result: string | ArrayBuffer | null = null
  private mode: "success" | "error"
  constructor(mode: "success" | "error") {
    this.mode = mode
  }
  readAsDataURL(_file: unknown): void {
    queueMicrotask(() => {
      if (this.mode === "success") {
        this.result = "data:text/plain;base64,aGVsbG8="
        this.onload?.()
      } else {
        this.onerror?.()
      }
    })
  }
}

describe("fileToDataUrl FileReader rejection contract (audit W2-V18)", () => {
  afterEach(() => {
    __setFileReaderFactoryForTest(undefined)
  })

  test("happy path resolves with the data URL", async () => {
    __setFileReaderFactoryForTest(() => new FakeReader("success"))
    const url = await fileToDataUrl({} as any)
    expect(url).toBe("data:text/plain;base64,aGVsbG8=")
  })

  test("FileReader onerror REJECTS the Promise (not hang, not resolve empty)", async () => {
    __setFileReaderFactoryForTest(() => new FakeReader("error"))
    await expect(fileToDataUrl({} as any)).rejects.toThrow(/FileReader/)
  })

  test("rejected Promise must be catchable in the standard for-of loop pattern (regression)", async () => {
    // The exact production-shape pattern the V18 fix relies on:
    //   for (const file of files) await processOne(file)
    // where processOne wraps fileToDataUrl in try/catch.
    __setFileReaderFactoryForTest(() => {
      // First call OK, second FAILS, third OK, fourth OK.
      let calls = 0
      return {
        onload: null,
        onerror: null,
        result: null,
        readAsDataURL(_f: unknown) {
          calls++
          // We need a stable per-call mode — use a closure flag.
          // (The factory returns a new reader per call so we can't
          // close over `this`'s state. We thread per-call mode via
          // a module-level counter.)
        },
      } as any
    })
    // Simpler test: drive the catching pattern explicitly with
    // pre-set rejection on call N=2.
    let factoryCalls = 0
    __setFileReaderFactoryForTest(() => {
      factoryCalls++
      const shouldFail = factoryCalls === 2
      return new FakeReader(shouldFail ? "error" : "success")
    })

    const files = ["a", "b", "c", "d"]
    const results: Array<{ file: string; ok: boolean }> = []
    for (const f of files) {
      try {
        const url = await fileToDataUrl(f)
        results.push({ file: f, ok: !!url })
      } catch {
        // Producer-side rejection caught — loop must NOT abort.
        results.push({ file: f, ok: false })
      }
    }
    // Pre-fix without the try/catch: the loop would have aborted
    // at file b (factoryCalls===2). Post-fix every file gets a
    // turn and we see the b-failure inline.
    expect(results.length).toBe(4)
    expect(results[0]).toEqual({ file: "a", ok: true })
    expect(results[1]).toEqual({ file: "b", ok: false })
    expect(results[2]).toEqual({ file: "c", ok: true })
    expect(results[3]).toEqual({ file: "d", ok: true })
  })
})
