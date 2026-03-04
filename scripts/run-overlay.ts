import { existsSync } from "fs"
import path from "path"

const ext = process.platform === "win32" ? ".exe" : ""
const root = process.cwd()
const manifest = path.join(root, "packages", "overlay", "src-tauri", "Cargo.toml")
const protocol = path.join(root, "scripts", "generate-overlay-protocol.ts")
const bins = [
  path.join(root, "packages", "overlay", "src-tauri", "target", "release", `opencorvus-overlay${ext}`),
  path.join(root, "packages", "overlay", "src-tauri", "target", "debug", `opencorvus-overlay${ext}`),
]
const name = `opencorvus-overlay${ext}`

async function code(cmd: string[]) {
  const p = Bun.spawn(cmd, {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  })
  return (await p.exited) ?? 1
}

async function run(cmd: string[]) {
  process.exit(await code(cmd))
}

function clearOld() {
  const mode = (process.env.OPENCORVUS_OVERLAY_SINGLETON_MODE ?? "kill-old-start-new").toLowerCase()
  if (mode === "reuse") return
  if (process.platform === "win32") {
    const taskkill = Bun.which("taskkill")
    if (!taskkill) return
    Bun.spawnSync([taskkill, "/im", name, "/f"], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    })
    return
  }
  const pkill = Bun.which("pkill")
  if (!pkill) return
  Bun.spawnSync([pkill, "-x", name.replace(/\.exe$/i, "")], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  })
}

const gen = await code([process.execPath, protocol])
if (gen !== 0) process.exit(gen)

const bin = bins.find((item) => existsSync(item))
if (bin) {
  clearOld()
  console.log(`[overlay] starting ${bin}`)
  await run([bin])
}

const cargo = Bun.which("cargo")
if (cargo) {
  console.log("[overlay] binary not found, running cargo")
  await run([cargo, "run", "--manifest-path", manifest])
}

console.error("[overlay] unable to start: binary not found and cargo is unavailable")
console.error("[overlay] build once with: cd packages/overlay/src-tauri && cargo build --release")
console.error("[overlay] optional remote chat channels entry: bun run dev:bot")
process.exit(1)
