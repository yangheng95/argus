import { spawn, NearestRoot, which, log } from "../shared"
import type { Info } from "../shared"

export const Gleam: Info = {
  id: "gleam",
  extensions: [".gleam"],
  root: NearestRoot(["gleam.toml"]),
  async spawn(root) {
    const gleam = which("gleam")
    if (!gleam) {
      log.info("gleam not found, please install gleam first")
      return
    }
    return {
      process: spawn(gleam, ["lsp"], {
        cwd: root,
      }),
    }
  },
}
