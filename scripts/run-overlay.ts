import { existsSync } from "fs"
import path from "path"

const ext = process.platform === "win32" ? ".exe" : ""
const root = process.cwd()
const manifest = path.join(root, "packages", "overlay", "src-tauri", "Cargo.toml")
const bins = [
  path.join(root, "packages", "overlay", "src-tauri", "target", "release", `opencorvus-overlay${ext}`),
  path.join(root, "packages", "overlay", "src-tauri", "target", "debug", `opencorvus-overlay${ext}`),
]

async function run(cmd: string[]) {
  const p = Bun.spawn(cmd, {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  })
  const code = await p.exited
  process.exit(code ?? 1)
}

const bin = bins.find((item) => existsSync(item))
if (bin) {
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
