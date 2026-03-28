import { spawn, path, Global, BunProc, Filesystem, Instance, Flag, Process, which } from "../shared"
import type { Info } from "../shared"

export const DockerfileLS: Info = {
  id: "dockerfile",
  extensions: [".dockerfile", "Dockerfile"],
  root: async () => Instance.directory,
  async spawn(root) {
    let binary = which("docker-langserver")
    const args: string[] = []
    if (!binary) {
      const js = path.join(Global.Path.bin, "node_modules", "dockerfile-language-server-nodejs", "lib", "server.js")
      if (!(await Filesystem.exists(js))) {
        if (Flag.OPENCORVUS_DISABLE_LSP_DOWNLOAD) return
        await Process.spawn([BunProc.which(), "install", "dockerfile-language-server-nodejs"], {
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
    }
  },
}
