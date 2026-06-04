import { existsSync } from "fs"
import z from "zod"
import { mergeDeep, unique } from "remeda"
import { Config } from "./config"
import { ConfigPaths } from "./paths"
import { TuiInfo } from "./tui-schema"
import { Instance, lazyInstanceState } from "@/project/instance"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"
import { Global } from "@/global"
import * as TuiKeybind from "@/cli/cmd/tui/config/keybind"

export namespace TuiConfig {
  const log = Log.create({ service: "tui.config" })

  export const Info = TuiInfo

  export type Info = z.output<typeof Info>
  export type Resolved = Omit<Info, "keybinds" | "leader_timeout"> & {
    keybinds: TuiKeybind.BindingLookupView
    leader_timeout: number
  }

  function mergeInfo(target: Info, source: Info): Info {
    return mergeDeep(target, source)
  }

  function customPath() {
    return Flag.OPENCORVUS_TUI_CONFIG
  }

  const state = lazyInstanceState(async () => {
    const projectFiles = Flag.OPENCORVUS_DISABLE_PROJECT_CONFIG
      ? []
      : await ConfigPaths.projectFiles("tui", Instance.directory, Instance.worktree)
    const directories = await ConfigPaths.directories(Instance.directory, Instance.worktree)
    const custom = customPath()
    const managed = Config.managedConfigDir()

    let result: Info = {}

    for (const file of ConfigPaths.fileInDirectory(Global.Path.config, "tui")) {
      result = mergeInfo(result, await loadFile(file))
    }

    if (custom) {
      result = mergeInfo(result, await loadFile(custom))
      log.debug("loaded custom tui config", { path: custom })
    }

    for (const file of projectFiles) {
      result = mergeInfo(result, await loadFile(file))
    }

    for (const dir of unique(directories)) {
      if (!dir.endsWith(".opencorvus") && dir !== Flag.OPENCORVUS_CONFIG_DIR) continue
      for (const file of ConfigPaths.fileInDirectory(dir, "tui")) {
        result = mergeInfo(result, await loadFile(file))
      }
    }

    if (existsSync(managed)) {
      for (const file of ConfigPaths.fileInDirectory(managed, "tui")) {
        result = mergeInfo(result, await loadFile(file))
      }
    }

    return {
      config: resolve(result),
    }
  })

  export async function get(): Promise<Resolved> {
    return state().then((x) => x.config)
  }

  function resolve(info: Info): Resolved {
    const keybinds = TuiKeybind.parse(info.keybinds ?? {})
    return {
      ...info,
      keybinds: TuiKeybind.createLookup(keybinds),
      leader_timeout: info.leader_timeout ?? TuiKeybind.LeaderTimeoutDefault,
    }
  }

  async function loadFile(filepath: string): Promise<Info> {
    const text = await ConfigPaths.readFile(filepath)
    if (!text) return {}
    return load(text, filepath).catch((error) => {
      log.warn("failed to load tui config", { path: filepath, error })
      return {}
    })
  }

  async function load(text: string, configFilepath: string): Promise<Info> {
    const data = await ConfigPaths.parseText(text, configFilepath, "empty")
    if (!data || typeof data !== "object" || Array.isArray(data)) return {}

    const parsed = Info.safeParse(data)
    if (!parsed.success) {
      log.warn("invalid tui config", { path: configFilepath, issues: parsed.error.issues })
      return {}
    }

    return parsed.data
  }
}
