import fs from "fs/promises"
import os from "os"
import path from "path"

export const DASHSCOPE_CODING_BASE_URL = "https://coding.dashscope.aliyuncs.com/v1"
export const DASHSCOPE_MAINLAND_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"

function dashscopeBaseURL(key: string | undefined) {
  if (key?.startsWith("sk-sp-")) return DASHSCOPE_CODING_BASE_URL
  if (key?.startsWith("sk-")) return DASHSCOPE_MAINLAND_BASE_URL
  return DASHSCOPE_CODING_BASE_URL
}

function authPaths() {
  const home = os.homedir()
  return [
    process.env.XDG_DATA_HOME ? path.join(process.env.XDG_DATA_HOME, "opencorvus", "auth.json") : undefined,
    path.join(home, ".local", "share", "opencorvus", "auth.json"),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "opencorvus", "auth.json") : undefined,
    process.env.APPDATA ? path.join(process.env.APPDATA, "opencorvus", "auth.json") : undefined,
  ].filter((x): x is string => !!x)
}

async function keyFromAuth() {
  for (const file of authPaths()) {
    try {
      const raw = await fs.readFile(file, "utf-8")
      const json = JSON.parse(raw) as Record<string, unknown>
      const provider = "alibaba-cn"
      const data = json[provider]
      if (!data || typeof data !== "object" || Array.isArray(data)) continue
      const type = (data as Record<string, unknown>)["type"]
      const key = (data as Record<string, unknown>)["key"]
      if (type !== "api" || typeof key !== "string") continue
      const val = key.trim()
      if (!val) continue
      return { key: val, path: file, provider }
    } catch {}
  }
  return { key: undefined, path: undefined as string | undefined, provider: undefined as string | undefined }
}

export async function applyDashscopeRuntime() {
  const result = await keyFromAuth()
  return {
    key: result.key,
    authPath: result.path,
    authProvider: result.provider,
    baseURL: dashscopeBaseURL(result.key),
    useCodingPlan: !!result.key?.startsWith("sk-sp-"),
  }
}
