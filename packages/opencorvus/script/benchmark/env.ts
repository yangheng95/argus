import path from "path"

export async function loadBenchmarkEnv(metaDir: string, options?: { cwd?: string }) {
  const locked = new Set(
    Object.entries(process.env)
      .flatMap(([key, value]) => typeof value === "string" && value.trim() ? [key] : []),
  )
  const packageRoot = path.resolve(metaDir, "../..")
  const repoRoot = path.resolve(metaDir, "../../..")
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
  const key = env("DASHSCOPE_API_KEY", "CODING_DASHSCOPE_API_KEY", "ALIBABA_CODING_PLAN_API_KEY", "OPENCORVUS_EMBEDDED_DASHSCOPE_KEY")
  if (key) {
    process.env.DASHSCOPE_API_KEY ??= key
    process.env.ALIBABA_CODING_PLAN_API_KEY ??= key
  }
  const url = env("DASHSCOPE_API_URL", "CODING_DASHSCOPE_API_URL")
  if (url) process.env.DASHSCOPE_API_URL ??= url
}

export function dashscopeCodingKey() {
  const key = env("DASHSCOPE_API_KEY", "CODING_DASHSCOPE_API_KEY", "ALIBABA_CODING_PLAN_API_KEY", "OPENCORVUS_EMBEDDED_DASHSCOPE_KEY")
  return key?.startsWith("sk-sp-") ? key : undefined
}
