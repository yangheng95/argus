import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"

const TEST_FILE_PATTERN = /\.test\.(?:ts|tsx|js|mjs)$/

function normalizePath(value: string): string {
  return value.split(path.sep).join("/")
}

function hasDiscoverableTestFile(directory: string): boolean {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name)
    if (entry.isDirectory() && hasDiscoverableTestFile(child)) return true
    if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) return true
  }
  return false
}

function packageTestEntries(script: string): Set<string> {
  const args = script.split(/\s+/).filter(Boolean)
  const entries = new Set<string>()
  for (let index = 0; index < args.length; index++) {
    const arg = normalizePath(args[index]!)
    if (index === 0 && arg === "bun") continue
    if (index === 1 && arg === "test") continue
    if (arg.startsWith("-")) {
      if (arg === "--timeout") index++
      continue
    }
    if (arg.startsWith("test")) entries.add(arg.replace(/\/+$/, ""))
  }
  return entries
}

function discoverDirectTestEntries(packageRoot: string): string[] {
  const testRoot = path.join(packageRoot, "test")
  return fs
    .readdirSync(testRoot, { withFileTypes: true })
    .flatMap((entry) => {
      const child = path.join(testRoot, entry.name)
      if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) return [`test/${entry.name}`]
      if (entry.isDirectory() && hasDiscoverableTestFile(child)) {
        return [normalizePath(path.relative(packageRoot, child))]
      }
      return []
    })
    .sort()
}

function coversTestEntry(includedEntries: Set<string>, entry: string): boolean {
  return includedEntries.has("test") || includedEntries.has(entry)
}

describe("opencorvus package test entry", () => {
  test("covers every discoverable test directory and top-level test file in the default package suite", () => {
    const packageRoot = path.resolve(import.meta.dir, "../..")
    const packageJsonPath = path.join(packageRoot, "package.json")
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
      scripts?: Record<string, string>
    }

    const testScript = packageJson.scripts?.test ?? ""
    const includedEntries = packageTestEntries(testScript)
    const discoverableEntries = discoverDirectTestEntries(packageRoot)
    const uncoveredEntries = discoverableEntries.filter((entry) => !coversTestEntry(includedEntries, entry))

    expect([...includedEntries]).toEqual(["test"])
    expect(discoverableEntries).toContain("test/engine")
    expect(discoverableEntries).toContain("test/orchestrator")
    expect(discoverableEntries).toContain("test/script")
    expect(discoverableEntries).toContain("test/acceptance-plan-restart-closure.test.ts")
    expect(uncoveredEntries).toEqual([])
  })
})
