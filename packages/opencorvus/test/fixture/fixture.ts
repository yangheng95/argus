import { $ } from "bun"
import * as fs from "fs/promises"
import os from "os"
import path from "path"
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
export async function tmpdir<T>(options?: TmpDirOptions<T>) {
  const dirpath = sanitizePath(path.join(os.tmpdir(), "opencorvus-test-" + Math.random().toString(36).slice(2)))
  await fs.mkdir(dirpath, { recursive: true })
  if (options?.git) {
    await $`git init`.cwd(dirpath).quiet()
    await $`git commit --allow-empty -m "root commit ${dirpath}"`.cwd(dirpath).quiet()
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
      await options?.dispose?.(dirpath)
      // await fs.rm(dirpath, { recursive: true, force: true })
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
