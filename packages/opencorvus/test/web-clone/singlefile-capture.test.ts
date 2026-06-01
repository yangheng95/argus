import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { SingleFileCaptureTestHooks } from "../../src/web-clone/singlefile-capture"

const packageRoot = path.resolve(import.meta.dir, "..", "..")
const captureSourcePath = path.join(packageRoot, "src", "web-clone", "singlefile-capture.ts")

describe("singlefile capture packaging contract", () => {
  test("does not depend on an external node_modules bin shim", async () => {
    const source = await Bun.file(captureSourcePath).text()

    expect(source).toContain('from "single-file-cli/single-file-cli-api.js"')
    expect(source).not.toContain("node_modules")
    expect(source).not.toContain(".bin")
    expect(source).not.toContain("Bun.spawn")
    expect(source).not.toContain("resolveSingleFileExecutable")
    expect(source).toContain('browserWaitUntil: "DOMContentLoaded"')
    expect(source).toContain("browserLoadMaxTime")
    expect(source).toContain("errorsFile")
    expect(source).toContain("debugMessagesFile")
  })

  test("uses the published SingleFile API entrypoint", async () => {
    const api = await import("single-file-cli/single-file-cli-api.js")

    expect(typeof api.initialize).toBe("function")
  })

  test("surfaces SingleFile diagnostic logs when output is missing", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "singlefile-diagnostics-"))
    try {
      const errorsFile = path.join(tmp, "singlefile-errors.log")
      const debugMessagesFile = path.join(tmp, "singlefile-debug.log")
      await fs.writeFile(errorsFile, "Load timeout\nURL: https://example.test/\n", "utf8")
      await fs.writeFile(debugMessagesFile, "[debug] Retrying with waitUntil DOMContentLoaded\n", "utf8")

      const diagnostics = await SingleFileCaptureTestHooks.readSingleFileDiagnostics({
        errorsFile,
        debugMessagesFile,
      })

      expect(diagnostics).toContain("SingleFile diagnostics")
      expect(diagnostics).toContain("Load timeout")
      expect(diagnostics).toContain("Retrying with waitUntil DOMContentLoaded")
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })
})
