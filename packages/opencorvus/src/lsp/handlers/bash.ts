import { spawn, path, Global, BunProc, Filesystem, Instance, Flag, Process, which } from "../shared"
import type { Info } from "../shared"

export const BashLS: Info = {
  id: "bash",
  extensions: [".sh", ".bash", ".zsh", ".ksh"],
  root: async () => Instance.directory,
  async spawn(root) {
    let binary = which("bash-language-server")
    const args: string[] = []
    if (!binary) {
      const js = path.join(Global.Path.bin, "node_modules", "bash-language-server", "out", "cli.js")
      if (!(await Filesystem.exists(js))) {
        if (Flag.OPENCORVUS_DISABLE_LSP_DOWNLOAD) return
        await Process.spawn([BunProc.which(), "install", "bash-language-server"], {
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
    args.push("start")
    const proc = spawn(binary, args, {
      cwd: root,
      env: {
        ...process.env,
        BUN_BE_BUN: "1",
      },
    })
    return {
      process: proc,
    }
  },
}
