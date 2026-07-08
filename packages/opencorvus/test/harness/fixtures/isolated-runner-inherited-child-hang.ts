import { test } from "bun:test"
import { spawn } from "node:child_process"
import { writeFileSync } from "node:fs"

const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  stdio: ["ignore", "inherit", "inherit"],
  windowsHide: true,
})

const pidFile = process.env.OPENCORVUS_ISOLATED_CHILD_PID_FILE
if (pidFile && child.pid) writeFileSync(pidFile, String(child.pid))

test("keeps a descendant process attached to inherited stdio", async () => {
  process.stdout.write("parent-before-hang\n")
  await new Promise(() => undefined)
})
