import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import path from "path"

const tuiRoot = path.join(import.meta.dir, "../../src/cli/cmd/tui")

describe("OpenCode-derived path formatter wiring", () => {
  test("keeps OpenCode path-format provider semantics in the copied file", () => {
    const source = readFileSync(path.join(tuiRoot, "context/path-format.tsx"), "utf8")

    expect(source).toContain("Copied from OpenCode")
    expect(source).toContain("export function PathFormatterProvider")
    expect(source).toContain("export function usePathFormatter")
    expect(source).toContain("props.path || process.cwd()")
    expect(source).toContain("path.isAbsolute(input) ? input : path.resolve(root, input)")
    expect(source).toContain('if (!relative) return "."')
    expect(source).toContain('return absolute.replace(Global.Path.home, "~")')
  })

  test("session route consumes the provider instead of local path formatting", () => {
    const route = readFileSync(path.join(tuiRoot, "routes/session/index.tsx"), "utf8")

    expect(route).toContain('from "../../context/path-format"')
    expect(route).toContain("<PathFormatterProvider path={session()?.directory}>")
    expect(route).toContain("const pathFormatter = usePathFormatter()")
    expect(route).toContain("pathFormatter.format(props.input.filePath)")
    expect(route).toContain("pathFormatter.format(props.input.path)")
    expect(route).not.toContain("function normalizePath")
    expect(route).not.toContain("Global.Path.home")
  })
})
