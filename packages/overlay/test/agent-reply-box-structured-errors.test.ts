// AgentSessionReplyBox structured-error UX test.
//
// Pre-fix every refusal returned by POST /task/.../session/.../reply
// surfaced as HTTP 500 and the reply box showed a single generic banner
// for all of them. After the backend NamedError taxonomy (see
// orchestrator/direct-reply.ts) and the server.ts onError mapping, the
// box must:
//
//   1. Distinguish four named error cases via err.body.name
//   2. Show distinct i18n messages per case (zh-CN + en-US both populated)
//   3. Permanently disable itself on terminal cases (kind-not-allowed,
//      contract-gone) so the user does not pointlessly retry, while
//      keeping the envelope-missing case retryable (the agent might
//      issue its first turn at any moment)
//   4. Keep the reply box visible on every non-root agent session card.
//      Direct-reply validity remains the backend's job, and the box
//      renders structured 4xx/410 errors without losing the draft.
//
// Source-pattern checks mirror the rest of the overlay test suite's
// idiom (see dialog-service-single-source.test.ts) — running solid-js
// would require a render harness the overlay tests deliberately avoid.

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const OVERLAY_ROOT = join(import.meta.dir, "..")

function readText(rel: string): string {
  return readFileSync(join(OVERLAY_ROOT, rel), "utf8")
}

describe("AgentSessionReplyBox structured errors", () => {
  const replyBox = readText("src/components/AgentSessionReplyBox.tsx")
  const zhCN = readText("src/i18n/zh-CN.json")
  const enUS = readText("src/i18n/en-US.json")

  test("recognises every backend NamedError name", () => {
    for (const name of [
      "InvalidReplyTargetKindError",
      "BuildSessionDirectReplyError",
      "ReplyTargetEnvelopeMissingError",
      "SessionRuntimeContractMissingError",
    ]) {
      expect(replyBox).toContain(name)
    }
  })

  test("reads err.body.name (ApiError shape), not just err.name", () => {
    // ApiError wraps the parsed JSON body verbatim; NamedError.toObject()
    // returns `{ name, data }`. The reply box must look at body.name, not
    // err.name (which is "ApiError" for the wrapper). Pre-fix the box
    // only read err.message and lost the structured signal entirely.
    expect(replyBox).toContain("body")
    expect(replyBox).toMatch(/body[^.]*\.name|\(body as[^)]*\)\.name/)
  })

  test("treats SessionRuntimeContractMissingError as terminal (disables retry)", () => {
    // The runtime contract is process-local — once the server restarts
    // or the terminal collector is satisfied, no amount of retry from
    // the overlay restores it (see session/loop.ts:122 + spec §6 not
    // implemented). The reply box must disable itself rather than bait
    // a retry loop.
    expect(replyBox).toContain("SessionRuntimeContractMissingError")
    expect(replyBox).toContain("isTerminalError")
    expect(replyBox).toContain("terminalError")
    expect(replyBox).toContain("card__agent-reply--disabled")
  })

  test("keeps ReplyTargetEnvelopeMissingError retryable", () => {
    // The envelope appears the moment the agent issues its first user
    // turn; that can happen at any time, so a retry is meaningful. The
    // box must distinguish this from the terminal cases.
    const terminalArm = replyBox.match(/function isTerminalError[\s\S]*?\n\}/)
    expect(terminalArm).toBeTruthy()
    const arm = terminalArm![0]
    expect(arm).toContain("SessionRuntimeContractMissingError")
    expect(arm).toContain("InvalidReplyTargetKindError")
    expect(arm).toContain("BuildSessionDirectReplyError")
    // ReplyTargetEnvelopeMissingError must NOT be in the terminal list
    expect(arm).not.toMatch(/case "ReplyTargetEnvelopeMissingError":\s*\n\s*return true/)
  })

  test("i18n keys for the new error paths exist in both locales", () => {
    for (const locale of [zhCN, enUS]) {
      expect(locale).toContain("card.agent_reply_contract_gone")
      expect(locale).toContain("card.agent_reply_kind_not_allowed")
      expect(locale).toContain("card.agent_reply_envelope_missing")
      // Hybrid case BuildSessionDirectReplyError gets its own copy when
      // the backend's data.sessionKind !== "build" and data.envelopeAgent
      // === "build" (codex round 2 minor).
      expect(locale).toContain("card.agent_reply_build_envelope")
    }
  })

  test("BuildSessionDirectReplyError hybrid branch routes through data fields", () => {
    // Source-level assertion: the messageForError switch must inspect
    // info.data.sessionKind and info.data.envelopeAgent for the hybrid
    // branch, so a future refactor that drops the data plumbing fails
    // here rather than silently showing the generic kind_not_allowed
    // copy on the hybrid case.
    expect(replyBox).toContain("info.data?.sessionKind")
    expect(replyBox).toContain("info.data?.envelopeAgent")
    expect(replyBox).toContain("card.agent_reply_build_envelope")
  })
})

describe("Card / ChatBubble render reply box for every non-root agent session", () => {
  const card = readText("src/components/Card.tsx")
  const chatBubble = readText("src/components/ChatBubble.tsx")

  test("Card.tsx keeps phase and step agent sessions replyable in the UI", () => {
    expect(card).toContain("props.node.phaseSessionID")
    expect(card).toContain("phase?.phaseSessionID")
    expect(card).toContain("sessionID === rootTaskSessionID()")
    expect(card).not.toContain("canReceiveDirectAgentReply(kind)")
  })

  test("ChatBubble.tsx keeps all non-root agent session bubbles replyable in the UI", () => {
    expect(chatBubble).toContain('if (props.node.kind !== "agent") return undefined')
    expect(chatBubble).toContain("if (!sessionID || sessionID === rootTaskSessionID()) return undefined")
    expect(chatBubble).not.toContain("canReceiveDirectAgentReply(props.node.stage)")
  })
})
