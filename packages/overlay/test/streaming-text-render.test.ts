import { expect, mock, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  STREAMING_ACTIVE_TEXT_LIMIT,
  StreamingTextPartController,
  visibleStreamingText,
} from "../src/components/text-part-model"

const OVERLAY_ROOT = join(import.meta.dir, "..")

function readText(path: string): string {
  return readFileSync(join(OVERLAY_ROOT, path), "utf8")
}

test("streaming appends keep the active block raw and render completed blocks once", () => {
  const renderMarkdown = mock((source: string) => `<p>${source}</p>`)
  const model = new StreamingTextPartController(renderMarkdown)

  model.update("intro", true)
  let state = model.update("intro more", true)
  expect(state.activeText).toBe("intro more")
  expect(state.frozenHtml).toEqual([])
  expect(renderMarkdown).toHaveBeenCalledTimes(0)

  state = model.update("intro more\n\nnext", true)
  expect(state.activeText).toBe("next")
  expect(state.frozenHtml).toEqual(["<p>intro more</p>"])
  expect(renderMarkdown.mock.calls.map((call) => call[0])).toEqual(["intro more"])

  state = model.update("intro more\n\nnext tail", true)
  expect(state.activeText).toBe("next tail")
  expect(state.frozenHtml).toEqual(["<p>intro more</p>"])
  expect(renderMarkdown).toHaveBeenCalledTimes(1)
})

test("incremental split preserves frozen HTML references while the tail grows", () => {
  const renderMarkdown = mock((source: string) => ({ html: `<p>${source}</p>` }) as unknown as string)
  const model = new StreamingTextPartController(renderMarkdown)

  let state = model.update("stable block\n\nactive", true)
  const frozen = state.frozenHtml[0]
  state = model.update("stable block\n\nactive tail", true)

  expect(state.frozenHtml[0]).toBe(frozen)
  expect(state.activeText).toBe("active tail")
  expect(renderMarkdown).toHaveBeenCalledTimes(1)
})

test("unclosed fences stream as one active block across blank lines until completion", () => {
  const renderMarkdown = mock((source: string) => `<p>${source}</p>`)
  const model = new StreamingTextPartController(renderMarkdown)

  let state = model.update("```ts\nconst a = 1;\n\nstill code", true)
  expect(state.frozenHtml).toEqual([])
  expect(state.activeText).toBe("```ts\nconst a = 1;\n\nstill code")

  model.update("```ts\nconst a = 1;\n\nstill code\n```", true)
  expect(renderMarkdown).toHaveBeenCalledTimes(0)
  state = model.update("```ts\nconst a = 1;\n\nstill code\n```", false)

  expect(state.activeText).toBe("")
  expect(state.frozenHtml).toEqual(["<p>```ts\nconst a = 1;\n\nstill code\n```</p>"])
  expect(renderMarkdown).toHaveBeenCalledTimes(1)
})

test("non-prefix text changes rebuild the frozen cache for the new text", () => {
  const renderMarkdown = mock((source: string) => `<p>${source}</p>`)
  const model = new StreamingTextPartController(renderMarkdown)

  model.update("old frozen\n\nold active", true)
  expect(renderMarkdown.mock.calls.map((call) => call[0])).toEqual(["old frozen"])

  const state = model.update("new frozen\n\nnew active", true)

  expect(renderMarkdown.mock.calls.map((call) => call[0])).toEqual(["old frozen", "new frozen"])
  expect(state.frozenHtml).toEqual(["<p>new frozen</p>"])
  expect(state.activeText).toBe("new active")
})

test("streaming active block renders a bounded tail for long uninterrupted output", () => {
  const renderMarkdown = mock((source: string) => `<p>${source}</p>`)
  const model = new StreamingTextPartController(renderMarkdown)
  const longText = "x".repeat(STREAMING_ACTIVE_TEXT_LIMIT + 100)

  const state = model.update(longText, true)

  expect(state.frozenHtml).toEqual([])
  expect(state.activeText).toBe(visibleStreamingText(longText))
  expect(state.activeText.length).toBe(STREAMING_ACTIVE_TEXT_LIMIT + 4)
  expect(renderMarkdown).toHaveBeenCalledTimes(0)

  const completed = model.update(longText, false)
  expect(completed.activeText).toBe("")
  expect(renderMarkdown).toHaveBeenCalledTimes(1)
})

test("streaming active text CSS follows the current TextPart producer", () => {
  const textPart = readText("src/components/TextPart.tsx")
  const cardCss = readText("src/styles/surfaces/card.css")
  const inspectorCss = readText("src/styles/surfaces/inspector.css")
  const css = `${cardCss}\n${inspectorCss}`

  expect(textPart).toContain('class="md-active-text"')
  expect(textPart).not.toContain("md-active-block")
  expect(css).toContain(".card__goal-desc-text .md-active-text")
  expect(css).toContain(".gwg-objective-text .md-active-text")
  expect(css).toContain(".gwg-done-definition-text .md-active-text")
  expect(css).toContain(".gwg-eval-summary .md-active-text")
  expect(css).not.toContain(".md-active-block")
})
