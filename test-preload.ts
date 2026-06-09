import { afterAll } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const opencorvusTestRoot = path.join(os.tmpdir(), "opencorvus-root-test-data-" + process.pid)
await fs.mkdir(opencorvusTestRoot, { recursive: true })

process.env["OPENCORVUS_HOME"] = path.join(opencorvusTestRoot, "portable")
process.env["XDG_DATA_HOME"] = path.join(opencorvusTestRoot, "share")
process.env["XDG_CACHE_HOME"] = path.join(opencorvusTestRoot, "cache")
process.env["XDG_CONFIG_HOME"] = path.join(opencorvusTestRoot, "config")
process.env["XDG_STATE_HOME"] = path.join(opencorvusTestRoot, "state")
process.env["OPENCORVUS_TEST_HOME"] = path.join(opencorvusTestRoot, "home")
process.env["OPENCORVUS_TEST_MANAGED_CONFIG_DIR"] = path.join(opencorvusTestRoot, "managed")
process.env["OPENCORVUS_MODELS_PATH"] = path.join(
  import.meta.dir,
  "packages",
  "opencorvus",
  "test",
  "tool",
  "fixtures",
  "models-api.json",
)

afterAll(async () => {
  await fs.rm(opencorvusTestRoot, { recursive: true, force: true }).catch(() => undefined)
})

// Vite-injected globals must exist before any src module loads, because
// `utils/version.ts` reads `__OPENCORVUS_OVERLAY_VERSION__` at top level
// and is reached transitively by `services/dialog` → `services/app-dialog`
// → many src modules. Without this preload, tests that import event
// routing or any UI service crash with "ReferenceError" during module
// evaluation. Vite's define plugin handles this at build time; tests
// don't run Vite, so the preload supplies the same constant.
;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test"

export {}
