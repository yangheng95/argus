import fs from "fs/promises"
import { xdgData, xdgCache, xdgState } from "xdg-basedir"
import path from "path"
import os from "os"
import { Filesystem } from "../util/filesystem"
import { testScope } from "./test-context"

const app = "opencorvus"
const portableRoot = process.env.OPENCORVUS_HOME?.trim()
function testRoot() {
  return process.env.OPENCORVUS_TEST_HOME?.trim()
}

function resolveHome() {
  if (testRoot()) return testRoot()!
  try {
    const home = os.homedir()
    if (home) return home
  } catch {
    // os.homedir() can throw on misconfigured systems (missing $HOME, no passwd entry)
  }
  return process.env.HOME || process.env.USERPROFILE || os.tmpdir()
}

const home = resolveHome()
const isWin = process.platform === "win32"
const winLocal = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local")
const cwd = process.cwd()

function resolveConfig() {
  if (testRoot()) return path.join(testScope(testRoot()!), "config")
  return cwd
}

function resolveData() {
  if (testRoot()) return path.join(testScope(testRoot()!), "data")
  if (portableRoot) return path.join(portableRoot, "data")
  return path.join(xdgData || (isWin ? winLocal : path.join(home, ".local", "share")), app)
}

function resolveCache() {
  if (testRoot()) return path.join(testScope(testRoot()!), "cache")
  if (portableRoot) return path.join(portableRoot, "cache")
  return path.join(xdgCache || (isWin ? winLocal : path.join(home, ".cache")), app)
}

function resolveState() {
  if (testRoot()) return path.join(testScope(testRoot()!), "state")
  if (portableRoot) return path.join(portableRoot, "state")
  return path.join(xdgState || (isWin ? winLocal : path.join(home, ".local", "state")), app)
}

function resolveBin() {
  const root = testRoot()
  if (root) {
    // Managed binaries should outlive individual temporary workspaces during tests.
    return path.join(root, "shared", "data", "bin")
  }
  return path.join(resolveData(), "bin")
}

export namespace Global {
  export const Path = {
    // Allow override via OPENCORVUS_TEST_HOME for test isolation
    get home() {
      return resolveHome()
    },
    get data() {
      return resolveData()
    },
    get bin() {
      return resolveBin()
    },
    get log() {
      return path.join(resolveData(), "log")
    },
    get cache() {
      return resolveCache()
    },
    get config() {
      return resolveConfig()
    },
    get state() {
      return resolveState()
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
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    console.warn(`[global] cache cleanup failed (version ${version} → ${CACHE_VERSION}): ${detail}`)
  }
  await Filesystem.write(path.join(Global.Path.cache, "version"), CACHE_VERSION)
}
