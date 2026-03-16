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
import { Filesystem } from "@/util/filesystem"
import { Ripgrep } from "@/file/ripgrep"

export function createCodebaseTools(projectDir?: string) {
  const dir = Filesystem.resolve(projectDir ?? Instance.directory)

  function safePath(input: string): string | null {
    const value = Filesystem.windowsPath(input)
    const abs = path.isAbsolute(value) ? Filesystem.resolve(value) : Filesystem.resolve(path.resolve(dir, value))
    return Filesystem.contains(dir, abs) ? abs : null
  }

  return {
    read_file: tool({
      description:
        "Read the contents of a file. Returns the file contents with line numbers. " +
        "Use this to understand code structure, conventions, and existing patterns.",
      inputSchema: z.object({
        path: z.string().describe("File path relative to project root"),
        max_lines: z
          .number()
          .optional()
          .describe("Maximum lines to read (default 300). Use for large files."),
      }),
      execute: async ({ path: filePath, max_lines }) => {
        const abs = safePath(filePath)
        if (!abs) return "Error: path is outside the project boundary."
        try {
          const content = fs.readFileSync(abs, "utf-8")
          const lines = content.split("\n")
          const limit = max_lines ?? 300
          const slice = lines.slice(0, limit)
          const numbered = slice.map((line, i) => `${String(i + 1).padStart(5)} | ${line}`).join("\n")
          if (lines.length > limit) {
            return numbered + `\n... (${lines.length - limit} more lines, total ${lines.length})`
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
        "Returns matching lines with file paths and line numbers. " +
        "Use this to find specific code patterns, function definitions, imports, etc.",
      inputSchema: z.object({
        pattern: z.string().describe("Regex pattern to search for"),
        path: z.string().optional().describe("Subdirectory or file to search in (default: project root)"),
        max_results: z.number().optional().describe("Maximum matching lines (default 30)"),
      }),
      execute: async ({ pattern, path: searchPath, max_results }) => {
        const limit = max_results ?? 30
        const target = searchPath ? safePath(searchPath) : dir
        if (!target) return "Error: search path is outside the project boundary."
        try {
          const rgPath = await Ripgrep.filepath()
          const proc = Bun.spawn(
            [
              rgPath,
              "--no-heading",
              "--line-number",
              "--max-count",
              String(limit),
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
          const output = await new Response(proc.stdout).text()
          const error = await new Response(proc.stderr).text()
          const exitCode = await proc.exited
          const trimmed = output.trim()
          if (trimmed) return trimmed
          if (exitCode === 1 || exitCode === 2) return "No matches found."
          if (error.trim()) return `Error searching code: ${error.trim()}`
          return trimmed || "No matches found."
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
