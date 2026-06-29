import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const CASCADE_ROOT = join(import.meta.dir, "../src/styles/cascade")

function readTheme(file: string): string {
  return readFileSync(join(CASCADE_ROOT, file), "utf8")
}

function tokenDeclaration(css: string, token: string): string {
  return css.match(new RegExp(`--${token}\\s*:\\s*[^;]+;`))?.[0] ?? ""
}

test("window opacity drives the visible overlay shell surfaces", () => {
  for (const file of ["dark.css", "vscode-dark.css", "light.css"]) {
    const css = readTheme(file)
    for (const token of ["body-bg", "rail-surface", "chat-canvas", "inspector-surface", "panel-body-bg", "chrome"]) {
      const declaration = tokenDeclaration(css, token)
      expect(declaration).not.toContain("var(--ui-window-opacity)")
      expect(declaration).not.toContain("rgba(")
      expect(declaration).not.toContain("hsla(")
      expect(declaration).not.toContain("transparent")
    }
  }
})
