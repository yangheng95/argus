import path from "path"

export async function loadBenchmarkEnv(metaDir: string, options?: { cwd?: string }) {
  const locked = new Set(
    Object.entries(process.env).flatMap(([key, value]) => (typeof value === "string" && value.trim() ? [key] : [])),
  )
  const packageRoot = path.resolve(metaDir, "../..")
  const repoRoot = path.resolve(metaDir, "../../../..")
  const cwd = options?.cwd ? path.resolve(options.cwd) : process.cwd()
  const files = [...new Set([path.join(repoRoot, ".env"), path.join(packageRoot, ".env"), path.join(cwd, ".env")])]
  const loaded: string[] = []

  for (const file of files) {
    const text = await Bun.file(file)
      .text()
      .catch(() => "")
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
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
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

/**
 * Write custom local provider configs into the benchmark's OPENCORVUS_CONFIG_DIR
 * so they are available during Instance.provide() calls.
 *
 * Currently registers:
 *   - hexin: HEXIN_API_KEY + HEXIN_OPENAI_URL
 */
export async function prepareLocalProviders() {
  const configDir = process.env.OPENCORVUS_CONFIG_DIR
  if (!configDir) return

  const providers: Record<string, unknown> = {}

  // Hexin OpenAI Gateway
  const hexinKey = env("HEXIN_API_KEY")
  if (hexinKey) {
    const hexinUrl = env("HEXIN_OPENAI_URL")
    providers["hexin"] = {
      name: "Hexin OpenAI Gateway",
      // api: hexinUrl ? `${hexinUrl.replace(/\/+$/, "")}/v1` : "https://aimemodeldev.myhexin.com/litellm/v1",
      api: hexinUrl ? `${hexinUrl.replace(/\/+$/, "")}/v1` : "https://aimemodeldev.myhexin.com/litellm/v1",
      env: ["HEXIN_API_KEY"],
      models: {
        "gpt-5.4-mini": { name: "GPT-5.4 Mini", tool_call: true },
        "gpt-5.4": { name: "GPT-5.4", tool_call: true },
      },
    }
  }

  if (Object.keys(providers).length === 0) return

  const { mkdir } = await import("fs/promises")
  await mkdir(configDir, { recursive: true })

  // Merge with existing config override if present
  const cfgPath = path.join(configDir, "opencorvus.json")
  let existing: Record<string, unknown> = {}
  try {
    existing = JSON.parse(await Bun.file(cfgPath).text())
  } catch {}
  const merged = {
    ...existing,
    provider: { ...((existing.provider as Record<string, unknown>) ?? {}), ...providers },
  }
  await Bun.write(cfgPath, JSON.stringify(merged, null, 2))
}

export function dashscopeCodingKey() {
  const key = env("DASHSCOPE_API_KEY", "OPENCORVUS_EMBEDDED_DASHSCOPE_KEY")
  return key?.startsWith("sk-sp-") ? key : undefined
}

// `alibaba-coding-plan` (international) deliberately excluded — bench keys are
// 国内 sk-sp-*, the international endpoint coding-intl.dashscope.aliyuncs.com
// rejects them with HTTP 401. Use `-cn` exclusively (rule 8: no double source).
const preferredProviders = [
  "alibaba-coding-plan-cn",
  "alibaba-cn",
  "hexin",
  "google",
  "deepseek",
  "gitlab",
  "moonshotai-cn",
  "moonshotai",
  "huggingface",
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

export function explicitModel(providers: Awaited<ReturnType<typeof providerList>>, explicit: string) {
  if (explicit.startsWith("alibaba-coding-plan/")) {
    throw new Error(
      `benchmark model "${explicit}" rejected: international alibaba-coding-plan endpoint does not accept 国内 sk-sp-* keys (rule 8). Use alibaba-coding-plan-cn/<model> instead.`,
    )
  }
  if (explicit.includes("/")) return explicit
  for (const providerID of preferredProviders) {
    const provider = providers[providerID]
    if (provider?.models[explicit]) return `${providerID}/${explicit}`
  }
  for (const provider of Object.values(providers)) {
    if (provider.models[explicit]) return `${provider.id}/${explicit}`
  }
  throw new Error(`benchmark model not found: ${explicit}`)
}

export async function resolveBenchmarkModel(
  metaDir: string,
  options?: {
    cwd?: string
    explicitKeys?: string[]
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
      if (explicit) return explicitModel(providers, explicit)
      if (providers["alibaba-coding-plan-cn"]?.models["kimi-k2.5"]) return "alibaba-coding-plan-cn/kimi-k2.5"
      if (providers["alibaba-coding-plan-cn"]?.models["glm-5"]) return "alibaba-coding-plan-cn/glm-5"
      if (providers["hexin"]?.models["gpt-5.4-mini"]) return "hexin/gpt-5.4-mini"

      for (const providerID of preferredProviders) {
        const provider = providers[providerID]
        if (!provider) continue
        const [model] = Provider.sort(Object.values(provider.models))
        if (model) return `${providerID}/${model.id}`
      }

      const fallback = await Provider.defaultModel()
      return `${fallback.providerID}/${fallback.modelID}`
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
