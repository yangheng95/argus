import fs from "fs/promises"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import path from "path"
import os from "os"
import { Filesystem } from "../util/filesystem"

const app = "argus"

function resolveHome() {
  if (process.env.ARGUS_TEST_HOME) return process.env.ARGUS_TEST_HOME
  try {
    const home = os.homedir()
    if (home) return home
  } catch {}
  return process.env.HOME || process.env.USERPROFILE || os.tmpdir()
}

const home = resolveHome()
const isWin = process.platform === "win32"
const winLocal   = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local")
const winRoaming = process.env.APPDATA       || path.join(home, "AppData", "Roaming")

const data   = path.join(xdgData   || (isWin ? winLocal   : path.join(home, ".local", "share")), app)
const cache  = path.join(xdgCache  || (isWin ? winLocal   : path.join(home, ".cache")),           app)
const config = path.join(xdgConfig || (isWin ? winRoaming : path.join(home, ".config")),          app)
const state  = path.join(xdgState  || (isWin ? winLocal   : path.join(home, ".local", "state")),  app)

export namespace Global {
  export const Path = {
    // Allow override via ARGUS_TEST_HOME for test isolation
    get home() {
      return resolveHome()
    },
    data,
    bin: path.join(data, "bin"),
    log: path.join(data, "log"),
    cache,
    config,
    state,
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
