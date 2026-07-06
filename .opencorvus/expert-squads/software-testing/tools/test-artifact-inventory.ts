import { tool } from "@opencorvus-ai/plugin"
import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"

type PackageScript = {
  package_json: string
  script: string
  command: string
}

const skippedDirectoryNames = new Set([".git", "node_modules", "dist", "build", ".next", ".turbo", "coverage"])
const testConfigPattern = /^(playwright|vitest|jest|karma|cypress|mocha|ava)\.config\.[cm]?[jt]s$|^pytest\.ini$|^tox\.ini$|^noxfile\.py$/
const testScriptPattern = /\b(test|vitest|playwright|jest|mocha|pytest|cypress|ava|node --test|bun test)\b/i

function normalizeRelative(value: string) {
  return value.split(path.sep).join("/")
}

function assertContained(base: string, target: string, label: string) {
  const relative = path.relative(base, target)
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return
  throw new Error(`${label} must stay inside the active project directory`)
}

function shouldSkipDirectory(base: string, target: string) {
  const relative = normalizeRelative(path.relative(base, target))
  const segments = relative.split("/").filter(Boolean)
  if (segments.some((segment) => skippedDirectoryNames.has(segment))) return true
  return segments[0] === ".opencorvus" && ["r", "runtime", "worktrees"].includes(segments[1] ?? "")
}

function isRunResult(relativePath: string) {
  return /(^|\/)(?:\.opentest\/)?runs\/[^/]+\/result\.json$/.test(relativePath)
}

function uniqueSorted(values: Iterable<string>) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b))
}

async function collectFiles(base: string, root: string, maxFiles: number) {
  const files: string[] = []
  async function walk(current: string): Promise<void> {
    if (files.length >= maxFiles) return
    const entries = await readdir(current, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      if (files.length >= maxFiles) return
      const target = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (!shouldSkipDirectory(base, target)) await walk(target)
        continue
      }
      if (entry.isFile()) files.push(target)
    }
  }
  await walk(root)
  return files
}

async function collectPackageScripts(file: string, relativePath: string): Promise<PackageScript[]> {
  const parsed = JSON.parse(await readFile(file, "utf8")) as { scripts?: Record<string, unknown> }
  const scripts = parsed.scripts ?? {}
  return Object.entries(scripts)
    .filter(([, command]) => typeof command === "string" && testScriptPattern.test(command))
    .map(([script, command]) => ({
      package_json: relativePath,
      script,
      command: command as string,
    }))
}

export default tool({
  description:
    "Inspect software-testing artifacts under a project root, including TEST.md, script.ts, .opentest context files, run results, test configs, and package test scripts.",
  args: {
    root: tool.schema.string().min(1).describe("Path relative to the active project directory."),
    max_files: tool.schema.number().int().min(1).max(2000).describe("Maximum number of files to inspect."),
  },
  async execute(args, context) {
    const projectDirectory = path.resolve(context.directory)
    const root = path.resolve(projectDirectory, args.root)
    assertContained(projectDirectory, root, "root")
    const rootInfo = await stat(root)
    if (!rootInfo.isDirectory()) throw new Error("root must point to a directory")

    const absoluteFiles = await collectFiles(projectDirectory, root, args.max_files)
    const relativeFiles = absoluteFiles.map((file) => normalizeRelative(path.relative(projectDirectory, file)))
    const fileSet = new Set(relativeFiles)
    const testDirectories = uniqueSorted(
      relativeFiles.filter((file) => path.posix.basename(file) === "TEST.md").map((file) => path.posix.dirname(file)),
    )
    const runResults = relativeFiles.filter(isRunResult).sort((a, b) => a.localeCompare(b))
    const contextFiles = relativeFiles
      .filter(
        (file) =>
          file.endsWith("/.opentest/ctx.d.ts") ||
          file.endsWith("/.opentest/KNOWLEDGE.md") ||
          path.posix.basename(file) === "KNOWLEDGE.md",
      )
      .sort((a, b) => a.localeCompare(b))
    const testConfigs = relativeFiles
      .filter((file) => testConfigPattern.test(path.posix.basename(file)))
      .sort((a, b) => a.localeCompare(b))

    const packageScripts: PackageScript[] = []
    for (const [index, relativePath] of relativeFiles.entries()) {
      if (path.posix.basename(relativePath) !== "package.json") continue
      packageScripts.push(...(await collectPackageScripts(absoluteFiles[index]!, relativePath)))
    }

    const testCases = testDirectories.map((directory) => {
      const prefix = directory === "." ? "" : `${directory}/`
      return {
        directory,
        test_md: `${prefix}TEST.md`,
        script_ts: fileSet.has(`${prefix}script.ts`) ? `${prefix}script.ts` : null,
        context_contract: fileSet.has(`${prefix}.opentest/ctx.d.ts`) ? `${prefix}.opentest/ctx.d.ts` : null,
        run_result_count: runResults.filter((file) => file.startsWith(prefix) && isRunResult(file)).length,
      }
    })

    return JSON.stringify(
      {
        schema_version: 1,
        root: normalizeRelative(path.relative(projectDirectory, root)) || ".",
        scanned_file_count: relativeFiles.length,
        scan_limit_reached: relativeFiles.length >= args.max_files,
        test_cases: testCases,
        context_files: contextFiles,
        run_results: runResults,
        test_configs: testConfigs,
        package_scripts: packageScripts.sort((left, right) =>
          `${left.package_json}:${left.script}`.localeCompare(`${right.package_json}:${right.script}`),
        ),
      },
      null,
      2,
    )
  },
})
