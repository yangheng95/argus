#!/usr/bin/env node
import { readdir } from "node:fs/promises"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const browserTestDir = new URL("./browser/", import.meta.url)
const entries = await readdir(browserTestDir, { withFileTypes: true })
const files = entries
  .filter((entry) => entry.isFile() && (entry.name.endsWith(".test.mjs") || entry.name.endsWith(".test.ts")))
  .map((entry) => fileURLToPath(new URL(entry.name, browserTestDir)))
  .sort()

if (files.length === 0) {
  throw new Error("No Node browser tests found under packages/overlay/test/browser")
}

const child = spawn(process.execPath, ["--test", ...files], {
  stdio: "inherit",
  env: {
    ...process.env,
    OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER: "1",
  },
  windowsHide: true,
})

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`overlay browser tests stopped by ${signal}`)
    process.exit(1)
  }
  process.exit(code ?? 1)
})
