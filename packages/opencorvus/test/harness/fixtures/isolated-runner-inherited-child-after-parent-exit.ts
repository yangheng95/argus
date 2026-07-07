import { expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { writeFileSync } from "node:fs"

const child = spawn(
  process.execPath,
  ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
  {
    stdio: ["ignore", "inherit", "inherit"],
    windowsHide: true,
  },
)

const pidFile = process.env.OPENCORVUS_ISOLATED_CHILD_PID_FILE
if (pidFile && child.pid) writeFileSync(pidFile, String(child.pid))

test("passes while a descendant keeps inherited stdio open", () => {
  process.stdout.write("parent-exits-with-inherited-child\n")
  expect(true).toBe(true)
})
