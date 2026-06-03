/**
 * Codebase exploration tools for orchestrator agents (Planner, Evaluator).
 *
 * These are Vercel AI SDK `tool()` definitions that allow agents to read files,
 * search code, and list directories within the project boundary.
 */
import { tool } from "ai"
import z from "zod"
import path from "path"
import fs from "fs"
import { Instance } from "@/project/instance"

const READ_FILE_MAX_LINE_CHARS = 1200
const INLINE_BASE64_DATA_URI_RE = /data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=_-]+)/g

function sanitizeInlineDataUrisForPrompt(text: string): string {
  return text.replace(INLINE_BASE64_DATA_URI_RE, (_match, mime: string, payload: string) => {
    return `[inline ${mime} base64 data URI omitted: ${payload.length} chars; use the owning asset file or manifest reference instead]`
  })
}

async function collectLimitedLines(input: ReadableStream<Uint8Array>, limit: number, onLimit: () => void) {
  const decoder = new TextDecoder()
  const reader = input.getReader()
  const lines: string[] = []
  let buffer = ""
  let limited = false

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    while (true) {
      const newline = buffer.search(/\r?\n/)
      if (newline < 0) break
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(buffer[newline] === "\r" ? newline + 2 : newline + 1)
      lines.push(line)
      if (lines.length >= limit) {
        limited = true
        onLimit()
        reader.releaseLock()
        return { text: lines.join("\n"), limited }
      }
    }
  }

  buffer += decoder.decode()
  reader.releaseLock()
  if (buffer.length > 0) lines.push(buffer)
  return { text: lines.slice(0, limit).join("\n"), limited: lines.length > limit }
}

function evidencePathMatches(normalized: string, relative: string): boolean {
  return (
    normalized.endsWith(`/webpage-evidence/${relative}`) ||
    normalized === `webpage-evidence/${relative}`
  )
}

function evidencePathIncludes(normalized: string, relativeDir: string): boolean {
  return (
    normalized.includes(`/webpage-evidence/${relativeDir}/`) ||
    normalized.startsWith(`webpage-evidence/${relativeDir}/`)
  )
}

function rawWebpageEvidenceArtifactReason(relPath: string): string | null {
  const normalized = relPath.replace(/\\/g, "/")
  if (
    evidencePathMatches(normalized, "extracted-page.json") ||
    evidencePathMatches(normalized, "capture.html")
  ) {
    return "raw webpage evidence extraction JSON"
  }
  return null
}

function isWebpageEvidencePromptExcerpt(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/")
  return (
    evidencePathMatches(normalized, "page.ir.json") ||
    evidencePathMatches(normalized, "assets/manifest.json") ||
    evidencePathMatches(normalized, "segments.json") ||
    evidencePathMatches(normalized, "codegen-context.json") ||
    evidencePathMatches(normalized, "prd-evidence-summary.md") ||
    evidencePathIncludes(normalized, "source-ir") ||
    evidencePathIncludes(normalized, "source-skeleton") ||
    normalized.includes("/web-clone-source/") ||
    normalized.startsWith("web-clone-source/")
  )
}

function webpageEvidencePromptWorkingSurface(): string {
  return [
    "web-clone-source/README.md",
    "web-clone-source/implementation-blueprint.md",
    "web-clone-source/web-clone-context.md",
    "web-clone-source/source-ir/*.json",
    "web-clone-source/source-skeleton/critical.css",
    "web-clone-source/reference.png",
    "webpage-evidence/prd-evidence-summary.md",
    "webpage-evidence/source-ir/*.json",
    "webpage-evidence/source-skeleton/critical.css",
    "webpage-evidence/source-skeleton/index.html as raw evidence only",
    "webpage-evidence/page.ir.json",
    "webpage-evidence/assets/manifest.json",
  ].join(", ")
}

function detectBinaryKind(buf: Buffer, filePath: string): string | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "a PNG image"
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "a JPEG image"
  if (buf.length >= 4 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return "a GIF image"
  if (buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return "a WebP image"
  if (buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return "a PDF document"
  if (buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b) return "a ZIP/Office archive"
  // NUL-heavy probe — text files should not contain NUL bytes in the first 4KB
  const sample = buf.subarray(0, Math.min(buf.length, 4096))
  let nul = 0
  for (const b of sample) if (b === 0) nul++
  if (nul > 4) return `a binary file (${nul} NUL bytes in first ${sample.length}B, path=${filePath})`
  return null
}

export function createCodebaseTools(projectDir?: string) {
  const dir = projectDir ?? Instance.directory

  function safePath(relPath: string): string | null {
    const root = path.resolve(dir)
    const normalized = path.resolve(root, relPath)
    const relative = path.relative(root, normalized)
    if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return normalized
    return null
  }

  return {
    read_file: tool({
      description:
        "Read the contents of a file. Returns the file contents with line numbers. " +
        "Use this to understand code structure, conventions, and existing patterns. " +
        "For large files, set start_line to continue from the next unread line instead of re-reading from line 1.",
      inputSchema: z.object({
        path: z.string().describe("File path relative to project root"),
        start_line: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("1-based line number to start reading from (default 1). Use to page through large files."),
        max_lines: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum lines to read (default 300). Use for large files."),
      }),
      execute: async ({ path: filePath, start_line, max_lines }) => {
        const abs = safePath(filePath)
        if (!abs) return "Error: path is outside the project boundary."
        const rawWebpageEvidenceArtifact = rawWebpageEvidenceArtifactReason(filePath)
        if (rawWebpageEvidenceArtifact) {
          return (
            `Error: ${filePath} is ${rawWebpageEvidenceArtifact}. ` +
            "It is a tool input and evidence-manifest source, not a prompt-readable artifact. " +
            `Use ${webpageEvidencePromptWorkingSurface()} and webpage evidence tool summaries instead.`
          )
        }
        try {
          const buf = fs.readFileSync(abs)
          // Refuse known binary signatures and NUL-heavy content — decoding
          // a PNG/JPG/zip as UTF-8 produces garbage that wastes LLM context
          // and sends agents chasing nonsense. Image-like inputs must flow
          // via a vision channel, not read_file.
          const kind = detectBinaryKind(buf, filePath)
          if (kind) {
            return `Error: ${filePath} is ${kind}. read_file returns text only; use a vision/multimodal channel or a dedicated binary tool.`
          }
          const content = buf.toString("utf-8")
          const lines = content.split("\n")
          const limit = max_lines ?? 300
          const startIndex = Math.max(0, (start_line ?? 1) - 1)
          if (startIndex >= lines.length) {
            return `Error: start_line ${start_line ?? 1} is past end of file (${lines.length} lines).`
          }
          const slice = lines.slice(startIndex, startIndex + limit)
          const numbered = slice.map((line, i) => {
            const safeLine = sanitizeInlineDataUrisForPrompt(line)
            const displayLine =
              safeLine.length > READ_FILE_MAX_LINE_CHARS
                ? `${safeLine.slice(0, READ_FILE_MAX_LINE_CHARS)}... (line truncated, ${safeLine.length - READ_FILE_MAX_LINE_CHARS} more chars)`
                : safeLine
            return `${String(startIndex + i + 1).padStart(5)} | ${displayLine}`
          }).join("\n")
          const remaining = lines.length - (startIndex + slice.length)
          if (remaining > 0) {
            if (isWebpageEvidencePromptExcerpt(filePath)) {
              return (
                numbered +
                `\n... (${remaining} more lines, total ${lines.length}; bounded webpage evidence artifact excerpt returned. ` +
                "Do not page this artifact repeatedly. Use this excerpt with web-clone-source/source-ir evidence, webpage evidence summaries, and finalize the frontend design/replica contract.)"
              )
            }
            return (
              numbered +
              `\n... (${remaining} more lines, total ${lines.length}; ` +
              `next chunk: read_file path="${filePath}" start_line=${startIndex + slice.length + 1} max_lines=${limit})`
            )
          }
          return numbered
        } catch (e) {
          return `Error reading file: ${e instanceof Error ? e.message : String(e)}`
        }
      },
    }),

    find_files: tool({
      description:
        "Find files matching a glob pattern. Returns file paths relative to project root. " +
        "Use this to discover project structure and find relevant source files.",
      inputSchema: z.object({
        pattern: z.string().describe("Glob pattern (e.g., 'src/**/*.ts', '*.json', 'test/**/*.test.ts')"),
        max_results: z.number().optional().describe("Maximum results (default 80)"),
      }),
      execute: async ({ pattern, max_results }) => {
        const limit = max_results ?? 80
        try {
          const glob = new Bun.Glob(pattern)
          const files: string[] = []
          for await (const file of glob.scan({ cwd: dir, dot: false })) {
            if (file.includes("node_modules/") || file.includes(".git/")) continue
            files.push(file)
            if (files.length >= limit) break
          }
          if (files.length === 0) return "No files found matching the pattern."
          const result = files.join("\n")
          return files.length >= limit ? result + `\n(limited to ${limit} results)` : result
        } catch (e) {
          return `Error finding files: ${e instanceof Error ? e.message : String(e)}`
        }
      },
    }),

    search_code: tool({
      description:
        "Search file contents using a regex pattern (powered by ripgrep). " +
        'Required input shape: {"pattern":"<regex>"}. The search string field is named "pattern"; do not use "query". ' +
        "Returns matching lines with file paths and line numbers. " +
        "Use this to find specific code patterns, function definitions, imports, etc.",
      inputSchema: z.object({
        pattern: z.string().describe('Required regex pattern to search for. Field name is "pattern", not "query".'),
        path: z.string().optional().describe("Subdirectory or file to search in (default: project root)"),
        max_results: z.number().optional().describe("Maximum matching lines (default 30)"),
      }),
      execute: async ({ pattern, path: searchPath, max_results }) => {
        const limit = Math.max(1, Math.floor(max_results ?? 30))
        const target = searchPath ? safePath(searchPath) : dir
        if (!target) return "Error: search path is outside the project boundary."
        try {
          const proc = Bun.spawn(
            [
              "rg",
              "--no-heading",
              "--line-number",
              "--max-columns",
              "200",
              "--glob",
              "!node_modules",
              "--glob",
              "!.git",
              "--",
              pattern,
              target,
            ],
            { stdout: "pipe", stderr: "pipe" },
          )
          const output = await collectLimitedLines(proc.stdout, limit, () => {
            try {
              proc.kill()
            } catch {
              // Process may already have exited after producing the final allowed line.
            }
          })
          await proc.exited
          const trimmed = sanitizeInlineDataUrisForPrompt(output.text.trim())
          if (!trimmed) return "No matches found."
          return output.limited ? `${trimmed}\n(limited to ${limit} results)` : trimmed
        } catch {
          return "No matches found (or ripgrep not available)."
        }
      },
    }),

    list_directory: tool({
      description:
        "List files and directories at a given path. " +
        "Use this to understand project layout and find relevant directories.",
      inputSchema: z.object({
        path: z
          .string()
          .optional()
          .describe("Directory path relative to project root (default: project root)"),
      }),
      execute: async ({ path: dirPath }) => {
        const abs = dirPath ? safePath(dirPath) : dir
        if (!abs) return "Error: path is outside the project boundary."
        try {
          const entries = fs.readdirSync(abs, { withFileTypes: true })
          const sorted = entries
            .filter((e) => e.name !== "node_modules" && e.name !== ".git")
            .sort((a, b) => {
              if (a.isDirectory() && !b.isDirectory()) return -1
              if (!a.isDirectory() && b.isDirectory()) return 1
              return a.name.localeCompare(b.name)
            })
          return sorted.map((e) => `${e.isDirectory() ? "[dir] " : "      "}${e.name}`).join("\n")
        } catch (e) {
          return `Error listing directory: ${e instanceof Error ? e.message : String(e)}`
        }
      },
    }),
  }
}
