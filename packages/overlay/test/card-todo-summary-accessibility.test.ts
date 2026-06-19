import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const OVERLAY_ROOT = path.resolve(import.meta.dir, "..")

function read(relativePath: string): string {
  return readFileSync(path.join(OVERLAY_ROOT, relativePath), "utf8")
}

function json(relativePath: string): Record<string, string> {
  return JSON.parse(read(relativePath))
}

describe("CardTodoSummary accessibility contract", () => {
  test("CardHeader and ChatBubble use the shared TODO summary owner", () => {
    const cardHeader = read("src/components/CardHeader.tsx")
    const chatBubble = read("src/components/ChatBubble.tsx")

    for (const source of [cardHeader, chatBubble]) {
      expect(source).toContain('import { CardTodoSummary } from "./CardTodoSummary"')
      expect(source).toContain("<CardTodoSummary summary={summary()} />")
      expect(source).not.toContain('class="card__todo-progress"')
      expect(source).not.toContain(" done${")
    }
  })

  test("progressbar has a localized accessible name and value", () => {
    const source = read("src/components/CardTodoSummary.tsx")

    expect(source).toContain('role="progressbar"')
    expect(source).toContain('aria-label={t("todo.progress_label")}')
    expect(source).toContain("aria-valuenow={props.summary.completed}")
    expect(source).toContain("aria-valuemin={0}")
    expect(source).toContain("aria-valuemax={props.summary.total}")
    expect(source).toContain("aria-valuetext={progressText()}")
    expect(source).toContain('t("todo.progress_value_current"')
    expect(source).toContain('t("todo.progress_value"')
  })

  test("locale files own TODO progress copy", () => {
    for (const locale of ["en-US", "zh-CN"]) {
      const messages = json(`src/i18n/${locale}.json`)
      expect(messages["todo.progress_label"]).toBeTruthy()
      expect(messages["todo.progress_value"]).toContain("{{completed}}")
      expect(messages["todo.progress_value"]).toContain("{{total}}")
      expect(messages["todo.progress_value_current"]).toContain("{{current}}")
    }
  })
})
