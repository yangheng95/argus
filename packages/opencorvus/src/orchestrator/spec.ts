import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs"
import path from "path"
import { Instance } from "@/project/instance"

export function writeSpec(input: {
  taskID: string
  title: string
  content: string
  summary?: string
  source?: Record<string, unknown>
  createdAt?: number
}) {
  const content = input.content.trim()
  if (!content) return
  try {
    const createdAt = input.createdAt ?? Date.now()
    const specsDir = path.join(Instance.worktree, ".opencorvus", "specs")
    const slug = input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "task"
    const file = path.join(specsDir, `${createdAt}-${input.taskID}-${slug}.md`)
    mkdirSync(specsDir, { recursive: true })
    writeFileSync(file, content, "utf-8")
    return {
      summary: input.summary,
      file,
      source: input.source,
      created_at: createdAt,
    }
  } catch {
    return
  }
}

export function readSpec(input?: unknown) {
  const meta = specMeta(input)
  const file = meta?.file
  if (file && existsSync(file)) {
    const stat = statSync(file)
    return {
      content: readFileSync(file, "utf-8"),
      file,
      source: meta?.source,
      time: {
        created: meta?.created_at ?? stat.mtimeMs,
      },
    }
  }
  if (meta) return
  return latestSpec()
}

export function specFile(input?: unknown) {
  const meta = specMeta(input)
  if (meta?.file && existsSync(meta.file)) return meta.file
  if (meta) return
  return latestSpec()?.file
}

function latestSpec() {
  const specsDir = path.join(Instance.worktree, ".opencorvus", "specs")
  if (!existsSync(specsDir)) return
  const names = readdirSync(specsDir).filter((item) => item.endsWith(".md")).sort()
  const next = names.at(-1)
  if (!next) return
  const full = path.join(specsDir, next)
  const stat = statSync(full)
  return {
    content: readFileSync(full, "utf-8"),
    file: full,
    time: {
      created: stat.mtimeMs,
    },
  }
}

function specMeta(input?: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return
  const item = input as Record<string, unknown>
  if (typeof item.file !== "string" || !item.file) return
  return {
    file: item.file,
    source: item.source && typeof item.source === "object" && !Array.isArray(item.source)
      ? item.source as Record<string, unknown>
      : undefined,
    created_at: typeof item.created_at === "number" ? item.created_at : undefined,
  }
}
