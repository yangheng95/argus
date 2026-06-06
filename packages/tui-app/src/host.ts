import type { Event, Path, createOpenCorvusClient } from "@opencorvus-ai/sdk"

export type TuiHostEventSource = {
  on: (handler: (event: Event) => void) => () => void
}

export type TuiHostProjectPaths = Pick<Path, "home" | "state" | "config" | "worktree" | "directory">

export type TuiHostFileSystem = {
  readText(path: string): Promise<string>
  writeText(path: string, data: string): Promise<void>
  exists(path: string): Promise<boolean>
  mkdir(path: string): Promise<void>
}

export type TuiHostLocalState = {
  home: string
  config: string
  state: string
}

export type TuiHostAdapters = {
  client: ReturnType<typeof createOpenCorvusClient>
  eventSource?: TuiHostEventSource
  fileSystem: TuiHostFileSystem
  local: TuiHostLocalState
  paths: TuiHostProjectPaths
}
