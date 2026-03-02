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
  export declare const ARGUS_DISABLE_CLAUDE_CODE: boolean
  export declare const ARGUS_DISABLE_CLAUDE_CODE_PROMPT: boolean
  export declare const ARGUS_DISABLE_CLAUDE_CODE_SKILLS: boolean
  export declare const ARGUS_DISABLE_EXTERNAL_SKILLS: boolean
  export declare const ARGUS_DISABLE_PROJECT_CONFIG: boolean
  export const ARGUS_FAKE_VCS = process.env["ARGUS_FAKE_VCS"]
  export declare const ARGUS_CLIENT: string
  export const ARGUS_SERVER_PASSWORD = process.env["ARGUS_SERVER_PASSWORD"]
  export const ARGUS_SERVER_USERNAME = process.env["ARGUS_SERVER_USERNAME"]
  export const ARGUS_ENABLE_QUESTION_TOOL = truthy("ARGUS_ENABLE_QUESTION_TOOL")

  // Experimental
  export const ARGUS_EXPERIMENTAL = truthy("ARGUS_EXPERIMENTAL")
  export const ARGUS_EXPERIMENTAL_FILEWATCHER = truthy("ARGUS_EXPERIMENTAL_FILEWATCHER")
  export const ARGUS_EXPERIMENTAL_DISABLE_FILEWATCHER = truthy("ARGUS_EXPERIMENTAL_DISABLE_FILEWATCHER")
  export declare const ARGUS_EXPERIMENTAL_ICON_DISCOVERY: boolean

  const copy = process.env["ARGUS_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
  export const ARGUS_EXPERIMENTAL_DISABLE_COPY_ON_SELECT =
    copy === undefined ? process.platform === "win32" : truthy("ARGUS_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  export declare const ARGUS_ENABLE_EXA: boolean
  export const ARGUS_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("ARGUS_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")
  export const ARGUS_EXPERIMENTAL_OUTPUT_TOKEN_MAX = number("ARGUS_EXPERIMENTAL_OUTPUT_TOKEN_MAX")
  export declare const ARGUS_EXPERIMENTAL_OXFMT: boolean
  export const ARGUS_EXPERIMENTAL_LSP_TY = truthy("ARGUS_EXPERIMENTAL_LSP_TY")
  export declare const ARGUS_EXPERIMENTAL_LSP_TOOL: boolean
  export const ARGUS_DISABLE_FILETIME_CHECK = truthy("ARGUS_DISABLE_FILETIME_CHECK")
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

// Dynamic getters for flags with dependency chains.
// These MUST be evaluated at access time, not module load time,
// because parent flags (e.g. ARGUS_DISABLE_CLAUDE_CODE) may be set after module initialization.
Object.defineProperty(Flag, "ARGUS_DISABLE_CLAUDE_CODE", {
  get() {
    return truthy("ARGUS_DISABLE_CLAUDE_CODE")
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "ARGUS_DISABLE_CLAUDE_CODE_PROMPT", {
  get() {
    return Flag.ARGUS_DISABLE_CLAUDE_CODE || truthy("ARGUS_DISABLE_CLAUDE_CODE_PROMPT")
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "ARGUS_DISABLE_CLAUDE_CODE_SKILLS", {
  get() {
    return Flag.ARGUS_DISABLE_CLAUDE_CODE || truthy("ARGUS_DISABLE_CLAUDE_CODE_SKILLS")
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "ARGUS_DISABLE_EXTERNAL_SKILLS", {
  get() {
    return Flag.ARGUS_DISABLE_CLAUDE_CODE_SKILLS || truthy("ARGUS_DISABLE_EXTERNAL_SKILLS")
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "ARGUS_EXPERIMENTAL_ICON_DISCOVERY", {
  get() {
    return Flag.ARGUS_EXPERIMENTAL || truthy("ARGUS_EXPERIMENTAL_ICON_DISCOVERY")
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "ARGUS_ENABLE_EXA", {
  get() {
    return truthy("ARGUS_ENABLE_EXA") || Flag.ARGUS_EXPERIMENTAL || truthy("ARGUS_EXPERIMENTAL_EXA")
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "ARGUS_EXPERIMENTAL_OXFMT", {
  get() {
    return Flag.ARGUS_EXPERIMENTAL || truthy("ARGUS_EXPERIMENTAL_OXFMT")
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "ARGUS_EXPERIMENTAL_LSP_TOOL", {
  get() {
    return Flag.ARGUS_EXPERIMENTAL || truthy("ARGUS_EXPERIMENTAL_LSP_TOOL")
  },
  enumerable: true,
  configurable: false,
})
