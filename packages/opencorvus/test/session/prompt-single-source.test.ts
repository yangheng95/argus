import { expect, test } from "bun:test"
import { SessionPrompt } from "../../src/session/prompt"
import { resolvePromptParts } from "../../src/session/prompt/parts"
import { PromptInput } from "../../src/session/prompt/schema"

test("SessionPrompt re-exports the canonical prompt input schema", () => {
  expect(SessionPrompt.PromptInput).toBe(PromptInput)
})

test("SessionPrompt re-exports the canonical prompt part resolver", () => {
  expect(SessionPrompt.resolvePromptParts).toBe(resolvePromptParts)
})
