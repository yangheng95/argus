// Centralized process-level shims.
// All global side-effects that run once at startup are collected here
// so they are easy to audit and test.
//
// Side-effects that depend on runtime data (config parse results, server
// startup, Flag namespace, TUI context) stay in their original modules.

declare const OPENCORVUS_EMBEDDED_ENV: Record<string, string> | undefined

let installed = false

function warn(step: string, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[opencorvus bootstrap] ${step}: ${detail}\n`)
}

export function installProcessShims() {
  if (installed) return
  installed = true

  // 1. Apply embedded env vars (baked in at build time via --embed-env).
  //    External env vars take priority so users can still override at runtime.
  try {
    if (typeof OPENCORVUS_EMBEDDED_ENV === "object" && OPENCORVUS_EMBEDDED_ENV) {
      for (const [key, value] of Object.entries(OPENCORVUS_EMBEDDED_ENV)) {
        if (!(key in process.env) || process.env[key] === undefined) {
          process.env[key] = value
        }
      }
    }
  } catch (error) {
    warn("apply embedded env", error)
  }

  // 2. Restore original CWD if launched via the self-contained launcher
  //    (launcher.ts changes CWD to the binary's directory for native module resolution)
  if (process.env.OPENCORVUS_ORIGINAL_CWD) {
    try {
      process.chdir(process.env.OPENCORVUS_ORIGINAL_CWD)
    } catch (error) {
      warn("restore original cwd", error)
    }
  }

  // 3. Mark this process as an agent / opencorvus instance
  process.env.AGENT = "1"
  process.env.OPENCORVUS = "1"

  // 4. Prevent ai-sdk from logging warnings to stdout
  //    https://github.com/vercel/ai/blob/2dc67e0ef538307f21368db32d5a12345d98831b/packages/ai/src/logger/log-warnings.ts#L85
  muteAISdkWarnings()
}

export const installRuntimeShims = installProcessShims

export function muteAISdkWarnings() {
  ;(globalThis as Record<string, unknown>).AI_SDK_LOG_WARNINGS = false
}
