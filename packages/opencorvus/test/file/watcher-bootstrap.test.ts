import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"

const watcherSource = await fs.readFile(path.join(import.meta.dir, "..", "..", "src", "file", "watcher.ts"), "utf8")
const bootstrapSource = await fs.readFile(path.join(import.meta.dir, "..", "..", "src", "project", "bootstrap.ts"), "utf8")

describe("file watcher bootstrap", () => {
  test("bootstrap awaits watcher initialization", () => {
    expect(bootstrapSource).toContain("await FileWatcher.init()")
  })

  test("bootstrap awaits file index initialization", () => {
    expect(bootstrapSource).toContain("await File.init()")
  })

  test("watcher git directory resolution uses project filesystem metadata", () => {
    expect(watcherSource).not.toContain("$`git rev-parse --git-dir`")
    expect(watcherSource).not.toContain('git(["rev-parse", "--git-dir"]')
    expect(watcherSource).toContain("Project.localGitDirectory")
  })

  test("watcher uses native HEAD file watching outside experimental source watching", () => {
    expect(watcherSource).toContain('watch(file, { persistent: false }')
    expect(watcherSource).toContain("Flag.OPENCORVUS_EXPERIMENTAL_FILEWATCHER")
  })

  test("native HEAD watcher disposal waits for the close event", () => {
    expect(watcherSource).toContain("function closeNativeFileWatcher")
    expect(watcherSource).toContain('watcher.once("close", onClose)')
    expect(watcherSource).toContain('watcher.on("error", onRuntimeError)')
    expect(watcherSource).toContain("unsubscribe: () => closeNativeFileWatcher(watcher, onRuntimeError)")
    expect(watcherSource).toContain('watcher.off("error", runtimeErrorListener)')
    expect(watcherSource).not.toContain("unsubscribe: async () => watcher.close()")
  })

  test("parcel subscribe timeout cleans up a late subscription handle", () => {
    expect(watcherSource).toContain("function isSubscribeTimeoutError")
    expect(watcherSource).toContain("void pending.then(")
    expect(watcherSource).toContain("await lateSub.unsubscribe()")
    expect(watcherSource).toContain("parcel watcher late subscription cleanup failed")
    expect(watcherSource).toContain("parcel watcher subscription failed after timeout")
  })
})
