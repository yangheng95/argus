import { spawn, path, Global, BunProc, Filesystem, Flag, Process, NearestRoot, which } from "../shared"
import type { Info } from "../shared"

export const PHPIntelephense: Info = {
  id: "php intelephense",
  extensions: [".php"],
  root: NearestRoot(["composer.json", "composer.lock", ".php-version"]),
  async spawn(root) {
    let binary = which("intelephense")
    const args: string[] = []
    if (!binary) {
      const js = path.join(Global.Path.bin, "node_modules", "intelephense", "lib", "intelephense.js")
      if (!(await Filesystem.exists(js))) {
        if (Flag.OPENCORVUS_DISABLE_LSP_DOWNLOAD) return
        await Process.spawn([BunProc.which(), "install", "intelephense"], {
          cwd: Global.Path.bin,
          env: {
            ...process.env,
            BUN_BE_BUN: "1",
          },
          stdout: "pipe",
          stderr: "pipe",
          stdin: "pipe",
        }).exited
      }
      binary = BunProc.which()
      args.push("run", js)
    }
    args.push("--stdio")
    const proc = spawn(binary, args, {
      cwd: root,
      env: {
        ...process.env,
        BUN_BE_BUN: "1",
      },
    })
    return {
      process: proc,
      initialization: {
        telemetry: {
          enabled: false,
        },
      },
    }
  },
}
