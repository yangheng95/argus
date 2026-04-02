/**
 * Shared file-reference patterns and constants for the planner subsystem.
 *
 * Canonical source — imported by both planner/agent.ts and planner/service.ts
 * to eliminate pattern duplication.
 */

import path from "node:path"

// ---------------------------------------------------------------------------
// File extension list (single source of truth)
// ---------------------------------------------------------------------------

export const FILE_EXTS = "ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|json|yaml|yml|toml|md|css|html|sql|sh|vue|svelte"

/** Matches relative/package paths like `src/foo/bar.ts`, `@scope/pkg/file.js` */
export const FILE_PATH_PATTERN =
  /(?:[a-zA-Z_@][\w@-]*\/)+[\w.-]+\.(?:ts|tsx|js|jsx|py|rs|go|java|json|yaml|yml|toml|css|html|sql)/g

// ---------------------------------------------------------------------------
// Working directory extraction
// ---------------------------------------------------------------------------

const CWD_PATTERNS = [
  /(?:绝对路径|absolute path)[：:\s]*([A-Z]:[/\\][^\s)）]+|\/[^\s)）]+)/i,
  /(?:工作目录|working dir(?:ectory)?)[^\n]*?([A-Z]:[/\\][^\s)）]+|\/[^\s)）]+)/i,
]

/** Extract an explicit working directory from request text (Chinese/English). */
export function extractWorkDir(request: string): string | undefined {
  for (const pat of CWD_PATTERNS) {
    const m = request.match(pat)
    if (m) return m[1].replace(/[/\\]+$/, "")
  }
  return undefined
}

// ---------------------------------------------------------------------------
// File reference extraction
// ---------------------------------------------------------------------------

/** Collect file reference strings from user request text. */
export function extractFileRefs(request: string): Set<string> {
  const refs = new Set<string>()
  let match: RegExpExecArray | null

  // Pattern 1: @file:path or @path
  const atPattern = /@(?:file:)?([./a-zA-Z][\w./\\-]*\.\w+)/g
  while ((match = atPattern.exec(request)) !== null) refs.add(match[1])

  // Pattern 2: Backtick-wrapped paths — `src/router.ts`
  const btPattern = new RegExp("`([./]?(?:[\\w@-]+[/\\\\])*[\\w.-]+\\.(?:" + FILE_EXTS + "))`", "g")
  while ((match = btPattern.exec(request)) !== null) refs.add(match[1])

  // Pattern 3: Bare relative paths — src/router.ts, ./src/router.ts
  const barePattern = new RegExp(
    "(?:^|[\\s,;，；（(])(\\.?(?:[\\w@-]+[/\\\\])+[\\w.-]+\\.(?:" + FILE_EXTS + "))(?=[\\s,;，；）)。:：]|$)",
    "gm",
  )
  while ((match = barePattern.exec(request)) !== null) refs.add(match[1].trim())

  return refs
}

// ---------------------------------------------------------------------------
// Resolve file references against candidate base directories
// ---------------------------------------------------------------------------

export interface ResolvedFileRef {
  ref: string
  path: string
  content: string
}

export async function resolveRefs(
  refs: Set<string>,
  baseDirs: string[],
  readFn: (absPath: string) => Promise<string | null>,
): Promise<ResolvedFileRef[]> {
  if (refs.size === 0 || baseDirs.length === 0) return []

  const results: ResolvedFileRef[] = []
  for (const ref of refs) {
    if (path.isAbsolute(ref)) {
      const content = await readFn(ref)
      if (content) results.push({ ref, path: ref, content })
      continue
    }
    for (const base of baseDirs) {
      const resolved = path.resolve(base, ref)
      const content = await readFn(resolved)
      if (content) {
        results.push({ ref, path: resolved, content })
        break
      }
    }
  }
  return results
}

// ---------------------------------------------------------------------------
// Requirement / entity extraction
// ---------------------------------------------------------------------------

const CN_ACTION_PAT = /^(?:添加|修改|删除|创建|导出|导入|确保|实现|重构|优化|移除|更新|替换|支持|使用|配置|设置|检查|启用|禁用)/
const EN_ACTION_PAT = /^(?:add|create|modify|delete|remove|implement|ensure|replace|fix|refactor|export|import|enable|disable|configure|check|support)\s/i

/** Extract structured requirements from bullet/numbered lists and action-verb lines. */
export function extractRequirements(request: string): string[] {
  const requirements: string[] = []
  for (const line of request.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.length < 4) continue
    if (/^[-*•]\s+/.test(trimmed)) {
      requirements.push(trimmed.replace(/^[-*•]\s+/, ""))
    } else if (/^\d+[.、)）]\s+/.test(trimmed)) {
      requirements.push(trimmed.replace(/^\d+[.、)）]\s+/, ""))
    } else if (CN_ACTION_PAT.test(trimmed) || EN_ACTION_PAT.test(trimmed)) {
      requirements.push(trimmed)
    }
  }
  return requirements
}

/** Extract code entities (type/class/function names) from request text. */
export function extractEntities(request: string): string[] {
  const entitySet = new Set<string>()
  let match: RegExpExecArray | null

  // English: keyword Name (e.g. "class Router", "type Middleware")
  const entPat = /`(\w+)`|(?:class|type|interface|function|method)\s+(\w+)/gi
  while ((match = entPat.exec(request)) !== null) {
    const name = match[1] || match[2]
    if (name && name.length > 1 && !/^(the|and|or|is|to|a|of|in)$/i.test(name)) entitySet.add(name)
  }

  // Chinese: Name 类型/方法/函数/接口 (e.g. "Middleware 类型", "Router 类")
  const cnPat = /(\w{2,})\s*(?:类型|类|方法|函数|接口)/g
  while ((match = cnPat.exec(request)) !== null) {
    entitySet.add(match[1])
  }

  return [...entitySet]
}
