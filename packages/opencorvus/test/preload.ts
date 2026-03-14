// IMPORTANT: Set env vars BEFORE any imports from src/ directory
// xdg-basedir reads env vars at import time, so we must set these first
import os from "os"
import path from "path"
import fs from "fs/promises"
import { afterAll } from "bun:test"

const liveE2E = process.env.OPENCORVUS_RUN_LIVE_E2E === "1" || process.env.OPENCORVUS_RUN_LIVE_E2E === "true"
const normal = liveE2E && process.env.OPENCORVUS_LIVE_E2E_USE_NORMAL_PATHS === "1"
const dir = normal ? undefined : path.join(os.tmpdir(), "opencorvus-test-data-" + process.pid)
const liveHome = liveE2E && normal ? path.join(os.tmpdir(), "opencorvus-live-e2e-" + process.pid) : undefined

async function copyIfExists(source: string, target: string) {
  try {
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.copyFile(source, target)
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return
    throw error
  }
}

if (dir) {
  await fs.mkdir(dir, { recursive: true })
}
if (liveHome) {
  await Promise.all(
    ["data", "cache", "state"].map((item) => fs.mkdir(path.join(liveHome, item), { recursive: true })),
  )
  process.env["OPENCORVUS_HOME"] = liveHome
  const home = os.homedir()
  const appData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local")
  const authRoots = [
    path.join(home, ".local", "share", "opencorvus"),
    path.join(appData, "opencorvus"),
  ]
  for (const root of authRoots) {
    await copyIfExists(path.join(root, "auth.json"), path.join(liveHome, "data", "auth.json"))
    await copyIfExists(path.join(root, "mcp-auth.json"), path.join(liveHome, "data", "mcp-auth.json"))
  }
}

afterAll(async () => {
  const { Database } = await import("../src/storage/db")
  Database.close()
  if (!dir && !liveHome) return
  const { Log } = await import("../src/util/log")
  const busy = (error: unknown) =>
    typeof error === "object" && error !== null && "code" in error && error.code === "EBUSY"
  const rm = async (left: number): Promise<void> => {
    Bun.gc(true)
    await Bun.sleep(100)
    return Promise.all(
      [dir, liveHome]
        .filter((item): item is string => !!item)
        .map((item) =>
          fs.rm(item, { recursive: true, force: true }).then(() => true).catch((error) => {
            if (!busy(error)) throw error
            if (left <= 1) {
              Log.Default.warn("test cleanup skipped due to persistent EBUSY", { dir: item, error })
              return true
            }
            return false
          }),
        ),
    ).then((result) => {
      if (left <= 1) return
      if (result.some((item) => item === false)) return rm(left - 1)
    })
  }

  // Windows can keep SQLite WAL handles alive until GC finalizers run, so we
  // force GC and retry teardown to avoid flaky EBUSY in test cleanup.
  await rm(30)
})

if (!liveE2E) {
  process.env["OPENCORVUS_MODELS_PATH"] = path.join(import.meta.dir, "tool", "fixtures", "models-api.json")
}

if (dir) {
  process.env["XDG_DATA_HOME"] = path.join(dir, "share")
  process.env["XDG_CACHE_HOME"] = path.join(dir, "cache")
  process.env["XDG_CONFIG_HOME"] = path.join(dir, "config")
  process.env["XDG_STATE_HOME"] = path.join(dir, "state")

  // Set test home directory to isolate tests from user's actual home directory
  // This prevents tests from picking up real user configs/skills from ~/.claude/skills
  const testHome = path.join(dir, "home")
  await fs.mkdir(testHome, { recursive: true })
  process.env["OPENCORVUS_TEST_HOME"] = testHome

  // Set test managed config directory to isolate tests from system managed settings
  const testManagedConfigDir = path.join(dir, "managed")
  process.env["OPENCORVUS_TEST_MANAGED_CONFIG_DIR"] = testManagedConfigDir

  // Write the cache version file to prevent global/index.ts from clearing the cache
  const cacheDir = path.join(dir, "cache", "opencorvus")
  await fs.mkdir(cacheDir, { recursive: true })
  await fs.writeFile(path.join(cacheDir, "version"), "21")
}

if (liveE2E) {
  const { Auth } = await import("../src/auth")
  const fallback = await Auth.codexFallback()
  const openaiCodex = fallback["openai-codex"]
  if (openaiCodex?.type === "oauth") {
    await Auth.set("openai-codex", openaiCodex)
  }
}

if (!liveE2E) {
  // Keep real provider credentials for live E2E runs.
  delete process.env["ANTHROPIC_API_KEY"]
  delete process.env["OPENAI_API_KEY"]
  delete process.env["GOOGLE_API_KEY"]
  delete process.env["GOOGLE_GENERATIVE_AI_API_KEY"]
  delete process.env["AZURE_OPENAI_API_KEY"]
  delete process.env["AWS_ACCESS_KEY_ID"]
  delete process.env["AWS_PROFILE"]
  delete process.env["AWS_REGION"]
  delete process.env["AWS_BEARER_TOKEN_BEDROCK"]
  delete process.env["OPENROUTER_API_KEY"]
  delete process.env["GROQ_API_KEY"]
  delete process.env["MISTRAL_API_KEY"]
  delete process.env["PERPLEXITY_API_KEY"]
  delete process.env["TOGETHER_API_KEY"]
  delete process.env["XAI_API_KEY"]
  delete process.env["DEEPSEEK_API_KEY"]
  delete process.env["FIREWORKS_API_KEY"]
  delete process.env["CEREBRAS_API_KEY"]
  delete process.env["SAMBANOVA_API_KEY"]
}

// Now safe to import from src/
const { Log } = await import("../src/util/log")

Log.init({
  print: false,
  dev: true,
  level: "DEBUG",
})
