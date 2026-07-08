import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  replaceDirectoryAfterSuccessfulBuild,
  replaceGeneratedArtifactsAfterSuccessfulBuild,
} from "../../../../packages/sdk/js/script/generation-transaction"

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

  test("rolls back all generated artifact targets when a multi-output commit fails", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-sdk-artifact-rollback-"))
    const distTarget = path.join(root, "js", "dist")
    const genTarget = path.join(root, "js", "src", "gen")
    const openapiTarget = path.join(root, "openapi.json")
    try {
      await fs.mkdir(distTarget, { recursive: true })
      await fs.mkdir(genTarget, { recursive: true })
      await fs.writeFile(path.join(distTarget, "index.js"), "old dist")
      await fs.writeFile(path.join(genTarget, "sdk.gen.ts"), "old gen")
      await fs.writeFile(openapiTarget, "old openapi")

      await expect(
        replaceGeneratedArtifactsAfterSuccessfulBuild({
          packageRoot: root,
          stagingRelative: "js/.tmp-sdk-artifacts",
          artifacts: [
            { stagingRelative: "dist", targetRelative: "js/dist", kind: "directory" },
            { stagingRelative: "gen", targetRelative: "js/src/gen", kind: "directory" },
            { stagingRelative: "missing-defaults.ts", targetRelative: "js/src/defaults.ts", kind: "file" },
            { stagingRelative: "openapi.json", targetRelative: "openapi.json", kind: "file" },
          ],
          build: async (stagingRoot) => {
            await fs.mkdir(path.join(stagingRoot, "dist"), { recursive: true })
            await fs.mkdir(path.join(stagingRoot, "gen"), { recursive: true })
            await fs.writeFile(path.join(stagingRoot, "dist", "index.js"), "new dist")
            await fs.writeFile(path.join(stagingRoot, "gen", "sdk.gen.ts"), "new gen")
            await fs.writeFile(path.join(stagingRoot, "openapi.json"), "new openapi")
          },
        }),
      ).rejects.toThrow()

      expect(await fs.readFile(path.join(distTarget, "index.js"), "utf8")).toBe("old dist")
      expect(await fs.readFile(path.join(genTarget, "sdk.gen.ts"), "utf8")).toBe("old gen")
      expect(await fs.readFile(openapiTarget, "utf8")).toBe("old openapi")
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
