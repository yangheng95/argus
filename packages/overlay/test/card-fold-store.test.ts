import { beforeEach, expect, test, describe } from "bun:test"
import { cardExpanded, toggleCard, setCardExpanded, clearConversationUiState } from "../src/store/conversation-ui"

beforeEach(() => {
  clearConversationUiState()
})

describe("cardExpanded / toggleCard", () => {
  test("returns defaultVal when no override exists", () => {
    expect(cardExpanded("x", "running", true)).toBe(true)
    expect(cardExpanded("x", "running", false)).toBe(false)
  })

  test("toggleCard stores an override that wins over default", () => {
    toggleCard("card-1", "running", true) // default=true → flipped to false
    expect(cardExpanded("card-1", "running", true)).toBe(false)

    toggleCard("card-1", "running", true) // flip back to true
    expect(cardExpanded("card-1", "running", true)).toBe(true)
  })

  test("override is discarded when status changes (stale-override protocol)", () => {
    toggleCard("card-2", "running", true) // false under running
    expect(cardExpanded("card-2", "running", true)).toBe(false)

    // status transition → override ignored → fall back to default
    expect(cardExpanded("card-2", "completed", true)).toBe(true)
    expect(cardExpanded("card-2", "completed", false)).toBe(false)

    // status flips back — original override still lives in the store,
    // but the statusAtSet ("running") now matches again, so it reactivates.
    expect(cardExpanded("card-2", "running", true)).toBe(false)
  })

  test("setCardExpanded sets value directly with current status", () => {
    setCardExpanded("card-3", false, "running")
    expect(cardExpanded("card-3", "running", true)).toBe(false)
    expect(cardExpanded("card-3", "completed", true)).toBe(true)
  })

  test("empty id is a no-op", () => {
    expect(cardExpanded("", "running", true)).toBe(true)
    toggleCard("", "running", true) // should not throw
    expect(cardExpanded("", "running", true)).toBe(true)
  })

  test("undefined status normalises consistently", () => {
    toggleCard("card-4", undefined, true) // default=true → flipped to false
    expect(cardExpanded("card-4", undefined, true)).toBe(false)
    // different status (any string) ⇒ override stale
    expect(cardExpanded("card-4", "running", true)).toBe(true)
  })

  test("clearConversationUiState resets fold state", () => {
    toggleCard("c1", "running", true)
    expect(cardExpanded("c1", "running", true)).toBe(false)

    clearConversationUiState()

    expect(cardExpanded("c1", "running", true)).toBe(true)
  })
})
