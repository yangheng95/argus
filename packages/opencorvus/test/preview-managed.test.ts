import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ManagedPreviewStartError, resolveManagedPreviewProjectRoot, startManagedPreview } from "../src/preview/managed"
import { stopAllManagedPreviewSessions } from "../src/preview/session"
import { Instance } from "../src/project/instance"

const tempDirs: string[] = []

afterEach(async () => {
  await stopAllManagedPreviewSessions()
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe("managed preview target resolution", () => {
  test("resolves the frontend subpackage root from changed files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "oc-preview-managed-root-"))
    tempDirs.push(root)
    const webDir = path.join(root, "packages", "web")
    await fs.mkdir(path.join(webDir, "src"), { recursive: true })
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
      type: "module",
      packageManager: "bun@1.3.13",
      scripts: { dev: "bun scripts/root-fail.ts" },
    }, null, 2))
    await fs.writeFile(path.join(webDir, "package.json"), JSON.stringify({
      type: "module",
      packageManager: "bun@1.3.13",
      scripts: { dev: "bun scripts/dev-server.ts" },
    }, null, 2))
    await fs.writeFile(path.join(webDir, "bun.lock"), "")

    await Instance.provide({
      directory: root,
      fn: async () => {
        const projectRoot = await resolveManagedPreviewProjectRoot({
          workspaceDir: root,
          changedFiles: ["packages/web/src/main.ts"],
        })
        expect(projectRoot).toBe(webDir)
      },
    })
  })

  test("surfaces resolved root and command when the preview process exits", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "oc-preview-managed-fail-"))
    tempDirs.push(root)
    const webDir = path.join(root, "packages", "web")
    await fs.mkdir(path.join(webDir, "scripts"), { recursive: true })
    await fs.writeFile(path.join(webDir, "package.json"), JSON.stringify({
      type: "module",
      packageManager: "npm@10.0.0",
      scripts: { dev: "node scripts/fail.mjs" },
    }, null, 2))
    await fs.writeFile(path.join(webDir, "package-lock.json"), "{}")
    await fs.writeFile(path.join(webDir, "scripts", "fail.mjs"), "process.exit(1)\n")

    await Instance.provide({
      directory: root,
      fn: async () => {
        let thrown: unknown
        try {
          await startManagedPreview({
            taskID: "tsk_preview_managed_fail",
            workspaceDir: root,
            changedFiles: ["packages/web/src/main.ts"],
          })
        } catch (error) {
          thrown = error
        }
        expect(thrown).toBeInstanceOf(ManagedPreviewStartError)
        expect((thrown as ManagedPreviewStartError).projectRoot).toBe(webDir)
        expect((thrown as ManagedPreviewStartError).session?.command).toBe("npm run dev")
        expect((thrown as ManagedPreviewStartError).evidence).toContain(`resolved_project_root=${webDir}`)
        expect((thrown as ManagedPreviewStartError).message).toContain("preview_process_exited")
      },
    })
  })

  test("fails on runtime readiness before attempting repo-root startup", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "oc-preview-managed-readiness-"))
    tempDirs.push(root)
    const webDir = path.join(root, "packages", "web")
    await fs.mkdir(webDir, { recursive: true })
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
      type: "module",
      packageManager: "bun@1.3.13",
      scripts: { dev: "bun -e \"process.exit(1)\"" },
    }, null, 2))
    await fs.writeFile(path.join(webDir, "package.json"), JSON.stringify({
      type: "module",
      packageManager: "bun@1.3.13",
      scripts: { dev: "bun -e \"process.exit(0)\"" },
    }, null, 2))

    await Instance.provide({
      directory: root,
      fn: async () => {
        let thrown: unknown
        try {
          await startManagedPreview({
            taskID: "tsk_preview_managed_readiness",
            workspaceDir: root,
            changedFiles: ["packages/web/src/main.ts"],
          })
        } catch (error) {
          thrown = error
        }
        expect(thrown).toBeInstanceOf(ManagedPreviewStartError)
        expect((thrown as ManagedPreviewStartError).projectRoot).toBe(webDir)
        expect((thrown as ManagedPreviewStartError).message).toContain("preview_runtime_readiness_failed")
        expect((thrown as ManagedPreviewStartError).evidence.some((item) => item.includes("runtime_readiness_failed=runtime-readiness:lockfile"))).toBe(true)
      },
    })
  })
})
