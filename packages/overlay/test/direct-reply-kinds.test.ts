// Cross-package equality guard.
//
// The overlay maintains its own copy of DIRECT_REPLY_AGENT_KINDS so the
// AgentSessionReplyBox can pre-filter cards by kind without a backend
// roundtrip. Rule 8 single-source: this test imports BOTH the overlay
// mirror and the canonical backend set and asserts they match exactly.
// If a backend addition is not mirrored here, this test fails — there
// is no chance of a silent drift where the overlay shows a reply box
// on a kind the route would 400.

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
