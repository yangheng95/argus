import * as fs from "fs/promises"
import * as fsSync from "node:fs"
import os from "os"
import path from "path"
import { spawnSync } from "node:child_process"
import type { Config } from "../../src/config/config"

// Strip null bytes from paths (defensive fix for CI environment issues)
function sanitizePath(p: string): string {
  return p.replace(/\0/g, "")
}

// Schema URL written by config.ts when generating opencorvus.json files.
// Kept in one place so tests stay in sync with the source.
const CONFIG_SCHEMA_URL = "https://opencorvus.ai/config.json"

type TmpDirOptions<T> = {
  git?: boolean
  config?: Partial<Config.Info>
  init?: (dir: string) => Promise<T>
  dispose?: (dir: string) => Promise<T>
}

function runFixtureGit(cwd: string, args: string[]) {
  const result = spawnSync("git", ["-c", "gc.auto=0", "-c", "maintenance.auto=false", ...args], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 15_000,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const stderr = result.stderr.toString().trim()
    const stdout = result.stdout.toString().trim()
    throw new Error(`git ${args.join(" ")} failed${stderr || stdout ? `: ${stderr || stdout}` : ""}`)
  }
}

function createGitTemplateRoot() {
  const root = sanitizePath(fsSync.mkdtempSync(path.join(os.tmpdir(), "opencorvus-test-git-template-")))
  runFixtureGit(root, ["init"])
  runFixtureGit(root, ["config", "user.name", "OpenCorvus Test"])
  runFixtureGit(root, ["config", "user.email", "opencorvus-test@example.invalid"])
  runFixtureGit(root, ["config", "commit.gpgsign", "false"])
  runFixtureGit(root, ["config", "gc.auto", "0"])
  runFixtureGit(root, ["config", "maintenance.auto", "false"])
  runFixtureGit(root, ["commit", "--no-gpg-sign", "--no-verify", "--allow-empty", "-m", "root commit"])
  return root
}

const GIT_TEMPLATE_ROOT = createGitTemplateRoot()

process.once("exit", () => {
  fsSync.rmSync(GIT_TEMPLATE_ROOT, { recursive: true, force: true })
})

export async function tmpdir<T>(options?: TmpDirOptions<T>) {
  const dirpath = sanitizePath(path.join(os.tmpdir(), "opencorvus-test-" + Math.random().toString(36).slice(2)))
  await fs.mkdir(dirpath, { recursive: true })
  if (options?.git) {
    await fs.cp(path.join(GIT_TEMPLATE_ROOT, ".git"), path.join(dirpath, ".git"), { recursive: true })
  }
  if (options?.config) {
    await Bun.write(
      path.join(dirpath, "opencorvus.json"),
      JSON.stringify({
        $schema: CONFIG_SCHEMA_URL,
        ...options.config,
      }),
    )
  }
  const extra = await options?.init?.(dirpath)
  const realpath = sanitizePath(await fs.realpath(dirpath))
  const result = {
    [Symbol.asyncDispose]: async () => {
      try {
        await options?.dispose?.(dirpath)
      } finally {
        await fs.rm(dirpath, { recursive: true, force: true })
      }
    },
    path: realpath,
    extra: extra as T,
  }
  return result
}

export async function createDirectoryAlias(target: string): Promise<string> {
  const alias = sanitizePath(
    path.join(
      path.dirname(target),
      `${path.basename(target)}-alias-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ),
  )
  await fs.rm(alias, { recursive: true, force: true })
  await fs.symlink(target, alias, process.platform === "win32" ? "junction" : "dir")
  return alias
}
