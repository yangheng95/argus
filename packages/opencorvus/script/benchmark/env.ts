import path from "path"

export async function loadBenchmarkEnv(metaDir: string, options?: { cwd?: string }) {
  const locked = new Set(
    Object.entries(process.env)
      .flatMap(([key, value]) => typeof value === "string" && value.trim() ? [key] : []),
  )
  const packageRoot = path.resolve(metaDir, "../..")
  const repoRoot = path.resolve(metaDir, "../../../..")
  const cwd = options?.cwd ? path.resolve(options.cwd) : process.cwd()
  const files = [...new Set([
    path.join(repoRoot, ".env"),
    path.join(packageRoot, ".env"),
    path.join(cwd, ".env"),
  ])]
  const loaded: string[] = []

  for (const file of files) {
    const text = await Bun.file(file).text().catch(() => "")
    if (!text) continue
    loaded.push(file)
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith("#")) continue
      const idx = line.indexOf("=")
      if (idx <= 0) continue
      const key = line.slice(0, idx).trim()
      if (!key || locked.has(key)) continue
      let value = line.slice(idx + 1).trim()
      if (!value) {
        process.env[key] = ""
        continue
      }
      if (
        (value.startsWith("\"") && value.endsWith("\""))
        || (value.startsWith("'") && value.endsWith("'"))
      ) {
        process.env[key] = value.slice(1, -1)
        continue
      }
      process.env[key] = value.replace(/\s+#.*$/, "").trim()
    }
  }

  return loaded
}

export function env(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key]?.trim()
    if (value) return value
  }
}

export function prepareDashscopeEnv() {
  // Keys should be set directly in .env with the exact names models.dev expects:
  //   ALIBABA_CODING_PLAN_API_KEY  (for alibaba-coding-plan / alibaba-coding-plan-cn)
  //   DASHSCOPE_API_KEY            (for alibaba / alibaba-cn)
  // No implicit copying between variable names — each provider reads its own env var.
  // Legacy aliases are still checked for backward compatibility but no longer copied.
  const url = env("DASHSCOPE_API_URL", "CODING_DASHSCOPE_API_URL")
  if (url) process.env.DASHSCOPE_API_URL ??= url
}

export function dashscopeCodingKey() {
  const key = env("DASHSCOPE_API_KEY", "CODING_DASHSCOPE_API_KEY", "ALIBABA_CODING_PLAN_API_KEY", "OPENCORVUS_EMBEDDED_DASHSCOPE_KEY")
  return key?.startsWith("sk-sp-") ? key : undefined
}

const preferredProviders = [
  "alibaba-coding-plan-cn",
  "alibaba-coding-plan",
  "alibaba-cn",
  "google",
  "deepseek",
  "gitlab",
  "moonshotai-cn",
  "moonshotai",
  "huggingface",
  "github-copilot",
]

async function providerList() {
  const { Provider } = await import("../../src/provider/provider")
  return Provider.list()
}

async function resetBenchmarkState() {
  const [{ Config }, { Instance }] = await Promise.all([
    import("../../src/config/config"),
    import("../../src/project/instance"),
  ])
  Config.global.reset()
  await Instance.disposeAll().catch(() => undefined)
}

function explicitModel(
  providers: Awaited<ReturnType<typeof providerList>>,
  explicit: string,
  allowOpenAICodex = false,
) {
  if (explicit.includes("/")) return explicit
  for (const providerID of preferredProviders) {
    const provider = providers[providerID]
    if (provider?.models[explicit]) return `${providerID}/${explicit}`
  }
  for (const provider of Object.values(providers)) {
    if (!allowOpenAICodex && provider.id === "openai-codex") continue
    if (provider.models[explicit]) return `${provider.id}/${explicit}`
  }
  throw new Error(`benchmark model not found: ${explicit}`)
}

export async function resolveBenchmarkModel(
  metaDir: string,
  options?: {
    cwd?: string
    explicitKeys?: string[]
    allowOpenAICodex?: boolean
  },
) {
  await resetBenchmarkState()
  const root = path.resolve(metaDir, "../..")
  const [{ Instance }, { Provider }] = await Promise.all([
    import("../../src/project/instance"),
    import("../../src/provider/provider"),
  ])
  return Instance.provide({
    directory: root,
    fn: async () => {
      const providers = await Provider.list()
      const explicit = env(...(options?.explicitKeys ?? ["OPENCORVUS_BENCHMARK_MODEL", "OPENCORVUS_E2E_MODEL"]))
      if (explicit) return explicitModel(providers, explicit, options?.allowOpenAICodex)
      if (providers["alibaba-coding-plan-cn"]?.models["qwen3.5-plus"]) return "alibaba-coding-plan-cn/qwen3.5-plus"
      if (providers["alibaba-coding-plan"]?.models["qwen3.5-plus"]) return "alibaba-coding-plan/qwen3.5-plus"
      if (providers["alibaba-cn"]?.models["qwen3.5-plus"]) return "alibaba-cn/qwen3.5-plus"
      if (providers["alibaba-coding-plan-cn"]?.models["kimi-k2.5"]) return "alibaba-coding-plan-cn/kimi-k2.5"
      if (providers["alibaba-coding-plan"]?.models["kimi-k2.5"]) return "alibaba-coding-plan/kimi-k2.5"
      if (providers["alibaba-cn"]?.models["kimi-k2.5"]) return "alibaba-cn/kimi-k2.5"

      for (const providerID of preferredProviders) {
        const provider = providers[providerID]
        if (!provider) continue
        const [model] = Provider.sort(Object.values(provider.models))
        if (model) return `${providerID}/${model.id}`
      }

      const fallback = await Provider.defaultModel()
      if (options?.allowOpenAICodex || !["openai-codex", "github-copilot"].includes(fallback.providerID)) {
        return `${fallback.providerID}/${fallback.modelID}`
      }

      for (const provider of Object.values(providers)) {
        if (provider.id === "openai-codex" || provider.id === "github-copilot") continue
        const [model] = Provider.sort(Object.values(provider.models))
        if (model) return `${provider.id}/${model.id}`
      }

      throw new Error("No live benchmark model available")
    },
  })
}

export async function ensureBenchmarkModel(metaDir: string, model: string) {
  await resetBenchmarkState()
  const [{ Instance }, { Provider }] = await Promise.all([
    import("../../src/project/instance"),
    import("../../src/provider/provider"),
  ])
  return Instance.provide({
    directory: path.resolve(metaDir, "../.."),
    fn: async () => {
      const parsed = Provider.parseModel(model)
      const resolved = await Provider.getModel(parsed.providerID, parsed.modelID)
      await Provider.getLanguage(resolved)
    },
  })
}

export async function hasBenchmarkModel(metaDir: string, model: string) {
  try {
    await ensureBenchmarkModel(metaDir, model)
    return true
  } catch {
    return false
  }
}
