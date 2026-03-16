import { WorktreeAdapter } from "./worktree"
import type { Config } from "../config"
import type { Adapter } from "./types"

export function getAdapter(config: Config): Adapter {
  switch (config.type) {
    case "worktree":
      return WorktreeAdapter
  }
}
