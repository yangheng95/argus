import fs from "node:fs/promises"
import path from "node:path"

async function removeWithRetry(target: string) {
  for (let attempt = 1; attempt <= 20; attempt++) {
    try {
      await fs.rm(target, { force: true, recursive: true })
      return
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error ? String((error as NodeJS.ErrnoException).code) : ""
      if (!["EBUSY", "ENOTEMPTY", "EPERM"].includes(code) || attempt === 20) throw error
      Bun.gc(true)
      await Bun.sleep(100 * attempt)
    }
  }
}

async function renameWithRetry(source: string, target: string) {
  for (let attempt = 1; attempt <= 20; attempt++) {
    try {
      await fs.rename(source, target)
      return
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error ? String((error as NodeJS.ErrnoException).code) : ""
      if (!["EBUSY", "ENOTEMPTY", "EPERM"].includes(code) || attempt === 20) throw error
      Bun.gc(true)
      await Bun.sleep(100 * attempt)
    }
  }
}

async function pathExists(target: string) {
  try {
    await fs.stat(target)
    return true
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error ? String((error as NodeJS.ErrnoException).code) : ""
    if (code === "ENOENT") return false
    throw error
  }
}

function resolveWithinPackage(packageRoot: string, relativePath: string) {
  const root = path.resolve(packageRoot)
  const resolved = path.resolve(root, relativePath)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`refusing to operate outside SDK package: ${resolved}`)
  }
  if (resolved === root) {
    throw new Error("refusing to replace SDK package root")
  }
  return resolved
}

export async function replaceDirectoryAfterSuccessfulBuild(input: {
  packageRoot: string
  stagingRelative: string
  targetRelative: string
  build: (stagingDir: string) => Promise<void>
}) {
  const stagingDir = resolveWithinPackage(input.packageRoot, input.stagingRelative)
  const targetDir = resolveWithinPackage(input.packageRoot, input.targetRelative)
  const backupDir = resolveWithinPackage(input.packageRoot, `${input.stagingRelative}-backup`)

  await removeWithRetry(stagingDir)
  await removeWithRetry(backupDir)
  try {
    await input.build(stagingDir)
  } catch (error) {
    await removeWithRetry(stagingDir).catch(() => undefined)
    throw error
  }

  const hadTarget = await pathExists(targetDir)
  if (hadTarget) await renameWithRetry(targetDir, backupDir)
  try {
    await fs.mkdir(path.dirname(targetDir), { recursive: true })
    await renameWithRetry(stagingDir, targetDir)
  } catch (error) {
    await removeWithRetry(targetDir).catch(() => undefined)
    if (hadTarget) await renameWithRetry(backupDir, targetDir)
    throw error
  }
  await removeWithRetry(backupDir)
}
