// Cross-package equality guard.
//
// The overlay maintains its own copy of DIRECT_REPLY_AGENT_KINDS so tests
// can pin frontend/backend understanding of the direct-reply route without
// a backend roundtrip. Rule 8 single-source: this test imports BOTH the
// overlay mirror and the canonical backend set and asserts they match
// exactly.

import { describe, expect, test } from "bun:test"
import { DIRECT_REPLY_AGENT_KINDS as overlay } from "../src/utils/direct-reply-kinds"
import { DIRECT_REPLY_AGENT_KINDS as backend } from "../../opencorvus/src/orchestrator/direct-reply"

describe("DIRECT_REPLY_AGENT_KINDS overlay mirror", () => {
  test("contains exactly the same kinds as the backend canonical", () => {
    const overlaySorted = [...overlay].sort()
    const backendSorted = [...backend].sort()
    expect(overlaySorted).toEqual(backendSorted)
  })
})
