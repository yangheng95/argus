function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

export namespace Flag {
  export const ARGUS_AUTO_SHARE = truthy("ARGUS_AUTO_SHARE")
  export const ARGUS_GIT_BASH_PATH = process.env["ARGUS_GIT_BASH_PATH"]
  export const ARGUS_CONFIG = process.env["ARGUS_CONFIG"]
  export declare const ARGUS_TUI_CONFIG: string | undefined
  export declare const ARGUS_CONFIG_DIR: string | undefined
  export const ARGUS_CONFIG_CONTENT = process.env["ARGUS_CONFIG_CONTENT"]
  export const ARGUS_DISABLE_AUTOUPDATE = truthy("ARGUS_DISABLE_AUTOUPDATE")
  export const ARGUS_DISABLE_PRUNE = truthy("ARGUS_DISABLE_PRUNE")
  export const ARGUS_DISABLE_TERMINAL_TITLE = truthy("ARGUS_DISABLE_TERMINAL_TITLE")
  export const ARGUS_PERMISSION = process.env["ARGUS_PERMISSION"]
  export const ARGUS_DISABLE_DEFAULT_PLUGINS = truthy("ARGUS_DISABLE_DEFAULT_PLUGINS")
  export const ARGUS_DISABLE_LSP_DOWNLOAD = truthy("ARGUS_DISABLE_LSP_DOWNLOAD")
  export const ARGUS_ENABLE_EXPERIMENTAL_MODELS = truthy("ARGUS_ENABLE_EXPERIMENTAL_MODELS")
  export const ARGUS_DISABLE_AUTOCOMPACT = truthy("ARGUS_DISABLE_AUTOCOMPACT")
  export const ARGUS_DISABLE_MODELS_FETCH = truthy("ARGUS_DISABLE_MODELS_FETCH")
  export const ARGUS_DISABLE_CLAUDE_CODE = truthy("ARGUS_DISABLE_CLAUDE_CODE")
  export const ARGUS_DISABLE_CLAUDE_CODE_PROMPT =
    ARGUS_DISABLE_CLAUDE_CODE || truthy("ARGUS_DISABLE_CLAUDE_CODE_PROMPT")
  export const ARGUS_DISABLE_CLAUDE_CODE_SKILLS =
    ARGUS_DISABLE_CLAUDE_CODE || truthy("ARGUS_DISABLE_CLAUDE_CODE_SKILLS")
  export const ARGUS_DISABLE_EXTERNAL_SKILLS =
    ARGUS_DISABLE_CLAUDE_CODE_SKILLS || truthy("ARGUS_DISABLE_EXTERNAL_SKILLS")
  export declare const ARGUS_DISABLE_PROJECT_CONFIG: boolean
  export const ARGUS_FAKE_VCS = process.env["ARGUS_FAKE_VCS"]
  export declare const ARGUS_CLIENT: string
  export const ARGUS_SERVER_PASSWORD = process.env["ARGUS_SERVER_PASSWORD"]
  export const ARGUS_SERVER_USERNAME = process.env["ARGUS_SERVER_USERNAME"]
  export const ARGUS_ENABLE_QUESTION_TOOL = truthy("ARGUS_ENABLE_QUESTION_TOOL")

  // Argus Monitor
  export const ARGUS_MONITOR_ENABLED = truthy("ARGUS_MONITOR_ENABLED")
  export const ARGUS_MONITOR_VISION_MODEL = process.env["ARGUS_MONITOR_VISION_MODEL"]
  export const ARGUS_MONITOR_BRAIN_MODEL = process.env["ARGUS_MONITOR_BRAIN_MODEL"]
  export const ARGUS_MONITOR_BRAIN_ENABLED = truthy("ARGUS_MONITOR_BRAIN_ENABLED")
  export const ARGUS_MONITOR_CAPTURE_INTERVAL = number("ARGUS_MONITOR_CAPTURE_INTERVAL")
  export const ARGUS_MONITOR_DIFF_THRESHOLD = number("ARGUS_MONITOR_DIFF_THRESHOLD")
  export const ARGUS_MONITOR_AUTONOMY_LEVEL = number("ARGUS_MONITOR_AUTONOMY_LEVEL")
  export const ARGUS_MONITOR_CAPTURE_MODE = process.env["ARGUS_MONITOR_CAPTURE_MODE"]
  export const ARGUS_MONITOR_WINDOW_TITLE = process.env["ARGUS_MONITOR_WINDOW_TITLE"]
  export const ARGUS_MONITOR_MAX_SCREENSHOTS = number("ARGUS_MONITOR_MAX_SCREENSHOTS")
  export const ARGUS_MONITOR_SCREENSHOT_DIR = process.env["ARGUS_MONITOR_SCREENSHOT_DIR"]

  // Experimental
  export const ARGUS_EXPERIMENTAL = truthy("ARGUS_EXPERIMENTAL")
  export const ARGUS_EXPERIMENTAL_FILEWATCHER = truthy("ARGUS_EXPERIMENTAL_FILEWATCHER")
  export const ARGUS_EXPERIMENTAL_DISABLE_FILEWATCHER = truthy("ARGUS_EXPERIMENTAL_DISABLE_FILEWATCHER")
  export const ARGUS_EXPERIMENTAL_ICON_DISCOVERY =
    ARGUS_EXPERIMENTAL || truthy("ARGUS_EXPERIMENTAL_ICON_DISCOVERY")

  const copy = process.env["ARGUS_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
  export const ARGUS_EXPERIMENTAL_DISABLE_COPY_ON_SELECT =
    copy === undefined ? process.platform === "win32" : truthy("ARGUS_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  export const ARGUS_ENABLE_EXA =
    truthy("ARGUS_ENABLE_EXA") || ARGUS_EXPERIMENTAL || truthy("ARGUS_EXPERIMENTAL_EXA")
  export const ARGUS_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("ARGUS_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")
  export const ARGUS_EXPERIMENTAL_OUTPUT_TOKEN_MAX = number("ARGUS_EXPERIMENTAL_OUTPUT_TOKEN_MAX")
  export const ARGUS_EXPERIMENTAL_OXFMT = ARGUS_EXPERIMENTAL || truthy("ARGUS_EXPERIMENTAL_OXFMT")
  export const ARGUS_EXPERIMENTAL_LSP_TY = truthy("ARGUS_EXPERIMENTAL_LSP_TY")
  export const ARGUS_EXPERIMENTAL_LSP_TOOL = ARGUS_EXPERIMENTAL || truthy("ARGUS_EXPERIMENTAL_LSP_TOOL")
  export const ARGUS_DISABLE_FILETIME_CHECK = truthy("ARGUS_DISABLE_FILETIME_CHECK")
  export const ARGUS_EXPERIMENTAL_PLAN_MODE = ARGUS_EXPERIMENTAL || truthy("ARGUS_EXPERIMENTAL_PLAN_MODE")
  export const ARGUS_EXPERIMENTAL_MARKDOWN = truthy("ARGUS_EXPERIMENTAL_MARKDOWN")
  export const ARGUS_MODELS_URL = process.env["ARGUS_MODELS_URL"]
  export const ARGUS_MODELS_PATH = process.env["ARGUS_MODELS_PATH"]

  function number(key: string) {
    const value = process.env[key]
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
}

// Dynamic getter for ARGUS_DISABLE_PROJECT_CONFIG
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "ARGUS_DISABLE_PROJECT_CONFIG", {
  get() {
    return truthy("ARGUS_DISABLE_PROJECT_CONFIG")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for ARGUS_TUI_CONFIG
// This must be evaluated at access time, not module load time,
// because tests and external tooling may set this env var at runtime
Object.defineProperty(Flag, "ARGUS_TUI_CONFIG", {
  get() {
    return process.env["ARGUS_TUI_CONFIG"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for ARGUS_CONFIG_DIR
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "ARGUS_CONFIG_DIR", {
  get() {
    return process.env["ARGUS_CONFIG_DIR"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for ARGUS_CLIENT
// This must be evaluated at access time, not module load time,
// because some commands override the client at runtime
Object.defineProperty(Flag, "ARGUS_CLIENT", {
  get() {
    return process.env["ARGUS_CLIENT"] ?? "cli"
  },
  enumerable: true,
  configurable: false,
})
