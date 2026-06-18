import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { replaceDirectoryAfterSuccessfulBuild } from "../../../../packages/sdk/js/script/generation-transaction"

describe("SDK build generated-directory transaction", () => {
  test("leaves the tracked generated directory unchanged when staging generation fails", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-sdk-gen-failure-"))
    const target = path.join(root, "src", "gen")
    const staging = path.join(root, ".tmp-sdk-gen")
    try {
      await fs.mkdir(target, { recursive: true })
      await fs.writeFile(path.join(target, "sdk.gen.ts"), "tracked sdk")

      await expect(
        replaceDirectoryAfterSuccessfulBuild({
          packageRoot: root,
          stagingRelative: ".tmp-sdk-gen",
          targetRelative: "src/gen",
          build: async (stagingDir) => {
            await fs.mkdir(stagingDir, { recursive: true })
            await fs.writeFile(path.join(stagingDir, "sdk.gen.ts"), "partial generated sdk")
            throw new Error("forced generation failure")
          },
        }),
      ).rejects.toThrow("forced generation failure")

      expect(await fs.readFile(path.join(target, "sdk.gen.ts"), "utf8")).toBe("tracked sdk")
      await expect(fs.stat(staging)).rejects.toThrow()
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("replaces the tracked generated directory only after staging generation succeeds", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-sdk-gen-success-"))
    const target = path.join(root, "src", "gen")
    try {
      await fs.mkdir(target, { recursive: true })
      await fs.writeFile(path.join(target, "sdk.gen.ts"), "old sdk")

      await replaceDirectoryAfterSuccessfulBuild({
        packageRoot: root,
        stagingRelative: ".tmp-sdk-gen",
        targetRelative: "src/gen",
        build: async (stagingDir) => {
          await fs.mkdir(stagingDir, { recursive: true })
          await fs.writeFile(path.join(stagingDir, "sdk.gen.ts"), "new sdk")
        },
      })

      expect(await fs.readFile(path.join(target, "sdk.gen.ts"), "utf8")).toBe("new sdk")
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
