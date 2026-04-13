import fs from "fs/promises"
import { xdgData, xdgCache, xdgState } from "xdg-basedir"
import path from "path"
import os from "os"
import { Filesystem } from "../util/filesystem"

const app = "opencorvus"
const isWin = process.platform === "win32"
const cwd = process.cwd()

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

export namespace Global {
  export const Path = {
    get home() { return resolveHome() },
    get data() { return dataPath() },
    get bin() { return path.join(dataPath(), "bin") },
    get log() { return path.join(dataPath(), "log") },
    get cache() { return cachePath() },
    get config() { return process.env.OPENCORVUS_GLOBAL_CONFIG_DIR?.trim() || cwd },
    get state() { return statePath() },
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
  try {
    const contents = await fs.readdir(Global.Path.cache)
    await Promise.all(
      contents.map((item) =>
        fs.rm(path.join(Global.Path.cache, item), {
          recursive: true,
          force: true,
        }),
      ),
    )
  } catch (e) {}
  await Filesystem.write(path.join(Global.Path.cache, "version"), CACHE_VERSION)
}
