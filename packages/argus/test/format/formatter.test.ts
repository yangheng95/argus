import { describe, test, expect } from "bun:test"
import * as Formatters from "../../src/format/formatter"

// All built-in formatters exported from formatter.ts
const ALL_FORMATTERS = [
  Formatters.gofmt,
  Formatters.mix,
  Formatters.prettier,
  Formatters.oxfmt,
  Formatters.biome,
  Formatters.zig,
  Formatters.clang,
  Formatters.ktlint,
  Formatters.ruff,
  Formatters.rlang,
  Formatters.uvformat,
  Formatters.rubocop,
  Formatters.standardrb,
  Formatters.htmlbeautifier,
  Formatters.dart,
  Formatters.ocamlformat,
  Formatters.terraform,
  Formatters.latexindent,
  Formatters.gleam,
  Formatters.shfmt,
  Formatters.nixfmt,
  Formatters.rustfmt,
  Formatters.pint,
  Formatters.ormolu,
  Formatters.cljfmt,
  Formatters.dfmt,
]

describe("Formatter metadata — required fields", () => {
  test("every formatter has a non-empty name", () => {
    for (const fmt of ALL_FORMATTERS) {
      expect(typeof fmt.name).toBe("string")
      expect(fmt.name.length).toBeGreaterThan(0)
    }
  })

  test("every formatter has a non-empty command array", () => {
    for (const fmt of ALL_FORMATTERS) {
      expect(Array.isArray(fmt.command)).toBe(true)
      expect(fmt.command.length).toBeGreaterThan(0)
    }
  })

  test("every formatter command contains $FILE placeholder", () => {
    for (const fmt of ALL_FORMATTERS) {
      const hasFilePlaceholder = fmt.command.some((arg) => arg.includes("$FILE"))
      expect(hasFilePlaceholder).toBe(true)
    }
  })

  test("every formatter has at least one file extension", () => {
    for (const fmt of ALL_FORMATTERS) {
      expect(Array.isArray(fmt.extensions)).toBe(true)
      expect(fmt.extensions.length).toBeGreaterThan(0)
    }
  })

  test("every formatter extension starts with a dot", () => {
    for (const fmt of ALL_FORMATTERS) {
      for (const ext of fmt.extensions) {
        expect(ext).toStartWith(".")
      }
    }
  })

  test("every formatter has an enabled() function", () => {
    for (const fmt of ALL_FORMATTERS) {
      expect(typeof fmt.enabled).toBe("function")
    }
  })

  test("formatter names are unique", () => {
    const names = ALL_FORMATTERS.map((f) => f.name)
    const unique = new Set(names)
    expect(unique.size).toBe(names.length)
  })
})

describe("Formatter metadata — specific formatters", () => {
  test("gofmt handles .go files", () => {
    expect(Formatters.gofmt.extensions).toContain(".go")
  })

  test("prettier handles common web extensions", () => {
    const webExts = [".js", ".ts", ".tsx", ".jsx", ".json", ".css", ".html"]
    for (const ext of webExts) {
      expect(Formatters.prettier.extensions).toContain(ext)
    }
  })

  test("ruff handles Python files", () => {
    expect(Formatters.ruff.extensions).toContain(".py")
    expect(Formatters.ruff.extensions).toContain(".pyi")
  })

  test("rustfmt handles .rs files", () => {
    expect(Formatters.rustfmt.extensions).toContain(".rs")
  })

  test("zig formatter handles .zig and .zon files", () => {
    expect(Formatters.zig.extensions).toContain(".zig")
    expect(Formatters.zig.extensions).toContain(".zon")
  })

  test("clang-format handles C/C++ files", () => {
    const cppExts = [".c", ".cpp", ".h", ".hpp"]
    for (const ext of cppExts) {
      expect(Formatters.clang.extensions).toContain(ext)
    }
  })

  test("terraform handles .tf files", () => {
    expect(Formatters.terraform.extensions).toContain(".tf")
  })

  test("shfmt handles shell scripts", () => {
    expect(Formatters.shfmt.extensions).toContain(".sh")
    expect(Formatters.shfmt.extensions).toContain(".bash")
  })

  test("nixfmt handles .nix files", () => {
    expect(Formatters.nixfmt.extensions).toContain(".nix")
  })

  test("dart formatter handles .dart files", () => {
    expect(Formatters.dart.extensions).toContain(".dart")
  })

  test("ktlint handles Kotlin files", () => {
    expect(Formatters.ktlint.extensions).toContain(".kt")
    expect(Formatters.ktlint.extensions).toContain(".kts")
  })

  test("cljfmt handles Clojure files", () => {
    expect(Formatters.cljfmt.extensions).toContain(".clj")
    expect(Formatters.cljfmt.extensions).toContain(".cljs")
  })
})
