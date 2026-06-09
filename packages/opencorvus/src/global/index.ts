import fs from "fs/promises"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import path from "path"
import os from "os"
import { Filesystem } from "../util/filesystem"

const app = "opencorvus"
const isWin = process.platform === "win32"

function resolveHome() {
  if (process.env.OPENCORVUS_TEST_HOME) return process.env.OPENCORVUS_TEST_HOME
  try {
    const home = os.homedir()
    if (home) return home
  } catch {}
  return process.env.HOME || process.env.USERPROFILE || os.tmpdir()
}

// All Global.Path entries resolve OPENCORVUS_HOME lazily on each access.
// This ensures benchmarks and tests can override OPENCORVUS_HOME AFTER
// static import chains have completed loading this module.
function portableRoot() {
  return process.env.OPENCORVUS_HOME?.trim()
}

function winLocalDir() {
  return process.env.LOCALAPPDATA || path.join(resolveHome(), "AppData", "Local")
}

function dataPath() {
  const root = portableRoot()
  if (root) return path.join(root, "data")
  return path.join(xdgData || (isWin ? winLocalDir() : path.join(resolveHome(), ".local", "share")), app)
}

function cachePath() {
  const root = portableRoot()
  if (root) return path.join(root, "cache")
  return path.join(xdgCache || (isWin ? winLocalDir() : path.join(resolveHome(), ".cache")), app)
}

function statePath() {
  const root = portableRoot()
  if (root) return path.join(root, "state")
  return path.join(xdgState || (isWin ? winLocalDir() : path.join(resolveHome(), ".local", "state")), app)
}

function configPath() {
  const root = portableRoot()
  if (root) return path.join(root, "config")
  return path.join(
    xdgConfig || (isWin ? path.join(process.env.APPDATA || winLocalDir()) : path.join(resolveHome(), ".config")),
    app,
  )
}

export namespace Global {
  export const Path = {
    get home() {
      return resolveHome()
    },
    get data() {
      return dataPath()
    },
    get bin() {
      return path.join(dataPath(), "bin")
    },
    get log() {
      return path.join(dataPath(), "log")
    },
    get cache() {
      return cachePath()
    },
    // Global user config — XDG-style (~/.config/opencorvus on Linux, %APPDATA%/opencorvus
    // on Windows, $OPENCORVUS_HOME/config when running portable). NEVER falls back to
    // process.cwd(): that historical default polluted the active project's primary
    // worktree with a synthetic package.json (`@opencorvus-ai/plugin` plugin manifest)
    // which then collided with build-agent commits at `git merge --ff-only` time.
    // Project-scoped config still lives under `<projectDir>/.opencorvus/`, picked up
    // by `ConfigPaths.directories` walking up from `Instance.directory`.
    get config() {
      return process.env.OPENCORVUS_GLOBAL_CONFIG_DIR?.trim() || configPath()
    },
    get state() {
      return statePath()
    },
  }
}

async function ensureDirectory(dir: string) {
  try {
    await fs.mkdir(dir, { recursive: true })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to initialize directory ${dir}: ${detail}`)
  }
}

await Promise.all([
  ensureDirectory(Global.Path.data),
  ensureDirectory(Global.Path.config),
  ensureDirectory(Global.Path.state),
  ensureDirectory(Global.Path.log),
  ensureDirectory(Global.Path.bin),
])

const CACHE_VERSION = "21"

const version = await Filesystem.readText(path.join(Global.Path.cache, "version")).catch(() => "0")

if (version !== CACHE_VERSION) {
  const contents = await fs.readdir(Global.Path.cache).catch((err) => {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return [] as string[]
    throw err
  })
  await Promise.all(
    contents.map((item) =>
      fs.rm(path.join(Global.Path.cache, item), {
        recursive: true,
        force: true,
      }),
    ),
  )
  await Filesystem.write(path.join(Global.Path.cache, "version"), CACHE_VERSION)
}
