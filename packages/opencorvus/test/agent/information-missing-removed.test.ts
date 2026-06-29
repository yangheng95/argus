import { expect, test } from "bun:test"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

const pkgRoot = resolve(import.meta.dir, "../..")
const repoRoot = resolve(pkgRoot, "../..")

const activeRoots = [
  join(pkgRoot, "src"),
  join(pkgRoot, "script"),
  join(pkgRoot, "test"),
  join(repoRoot, "packages/overlay/src"),
  join(repoRoot, "packages/overlay/test"),
]

const textExtensions = new Set([".json", ".ts", ".tsx", ".txt"])

function token(...parts: string[]): string {
  return parts.join("")
}

function extension(path: string): string {
  const dot = path.lastIndexOf(".")
  return dot === -1 ? "" : path.slice(dot)
}

function collectTextFiles(root: string): string[] {
  const output: string[] = []
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      const stat = statSync(path)
      if (stat.isDirectory()) {
        visit(path)
        continue
      }
      if (textExtensions.has(extension(path))) output.push(path)
    }
  }
  visit(root)
  return output
}

test("host information-missing prompt injection and stream detection are removed", () => {
  expect(existsSync(join(pkgRoot, "src/prompt/information-missing.ts"))).toBe(false)

  const forbidden = [
    token("INFORMATION", " MISSING"),
    token("<INFORMATION", " MISSING>"),
    token("fail_on_", "information_missing"),
    token("settings-fail-on-", "information-missing"),
    token("appendInformation", "MissingDiagnostic"),
    token("INFORMATION_", "MISSING_DIAGNOSTIC_TEXT"),
    token("messageHasInformation", "Missing"),
    token("extractInformation", "MissingBlock"),
    token("buildInformation", "MissingError"),
  ]

  for (const file of activeRoots.flatMap(collectTextFiles)) {
    const text = readFileSync(file, "utf8")
    for (const value of forbidden) {
      expect(text, `${file} must not contain ${value}`).not.toContain(value)
    }
  }
})
