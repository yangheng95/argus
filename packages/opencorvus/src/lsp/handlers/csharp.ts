import { spawn, path, Global, Flag, Process, NearestRoot, pathWithBin, which, log } from "../shared"
import type { Info } from "../shared"

export const CSharp: Info = {
  id: "csharp",
  root: NearestRoot([".slnx", ".sln", ".csproj", "global.json"]),
  extensions: [".cs"],
  async spawn(root) {
    let bin = which("csharp-ls", {
      PATH: pathWithBin(),
    })
    if (!bin) {
      if (!which("dotnet")) {
        log.error(".NET SDK is required to install csharp-ls")
        return
      }

      if (Flag.OPENCORVUS_DISABLE_LSP_DOWNLOAD) return
      log.info("installing csharp-ls via dotnet tool")
      const proc = Process.spawn(["dotnet", "tool", "install", "csharp-ls", "--tool-path", Global.Path.bin], {
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
      })
      const exit = await proc.exited
      if (exit !== 0) {
        log.error("Failed to install csharp-ls")
        return
      }

      bin = path.join(Global.Path.bin, "csharp-ls" + (process.platform === "win32" ? ".exe" : ""))
      log.info(`installed csharp-ls`, { bin })
    }

    return {
      process: spawn(bin, {
        cwd: root,
      }),
    }
  },
}

export const FSharp: Info = {
  id: "fsharp",
  root: NearestRoot([".slnx", ".sln", ".fsproj", "global.json"]),
  extensions: [".fs", ".fsi", ".fsx", ".fsscript"],
  async spawn(root) {
    let bin = which("fsautocomplete", {
      PATH: pathWithBin(),
    })
    if (!bin) {
      if (!which("dotnet")) {
        log.error(".NET SDK is required to install fsautocomplete")
        return
      }

      if (Flag.OPENCORVUS_DISABLE_LSP_DOWNLOAD) return
      log.info("installing fsautocomplete via dotnet tool")
      const proc = Process.spawn(["dotnet", "tool", "install", "fsautocomplete", "--tool-path", Global.Path.bin], {
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
      })
      const exit = await proc.exited
      if (exit !== 0) {
        log.error("Failed to install fsautocomplete")
        return
      }

      bin = path.join(Global.Path.bin, "fsautocomplete" + (process.platform === "win32" ? ".exe" : ""))
      log.info(`installed fsautocomplete`, { bin })
    }

    return {
      process: spawn(bin, {
        cwd: root,
      }),
    }
  },
}
