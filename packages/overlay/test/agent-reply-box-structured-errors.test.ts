// AgentSessionReplyBox structured-error UX test.
//
// Direct reply errors are visible diagnostics only. They must not permanently
// disable the reply box, and the backend must not rewrite failed direct replies
// into task-root operator messages.
//
// Source-pattern checks mirror the rest of the overlay test suite's
// idiom (see dialog-service-single-source.test.ts) — running solid-js
// would require a render harness the overlay tests deliberately avoid.

import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const OVERLAY_ROOT = join(import.meta.dir, "..")

function readText(rel: string): string {
  return readFileSync(join(OVERLAY_ROOT, rel), "utf8")
}

function overlaySourceText(): string {
  const root = join(OVERLAY_ROOT, "src")
  const chunks: string[] = []
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        visit(full)
        continue
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue
      chunks.push(readFileSync(full, "utf8"))
    }
  }
  visit(root)
  return chunks.join("\n")
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
      "AgentSessionPendingCoordinationError",
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

  test("does not turn structured errors into terminal disabled UI state", () => {
    expect(replyBox).toContain("SessionRuntimeContractMissingError")
    expect(replyBox).not.toContain("isTerminalError")
    expect(replyBox).not.toContain("terminalError")
    expect(replyBox).not.toContain("card__agent-reply--disabled")
    expect(replyBox).not.toContain("card__agent-reply-error--terminal")
    expect(replyBox).toContain("const canSend = () => !sending() && text().trim().length > 0")
  })

  test("i18n keys for the new error paths exist in both locales", () => {
    for (const locale of [zhCN, enUS]) {
      expect(locale).toContain("card.agent_reply_contract_gone")
      expect(locale).toContain("card.agent_reply_kind_not_allowed")
      expect(locale).toContain("card.agent_reply_envelope_missing")
      expect(locale).toContain("card.agent_reply_pending_coordination")
      expect(locale).toContain("card.agent_reply_attachment_reference")
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
    expect(replyBox).toContain("AgentSessionAttachmentReferenceError")
    expect(replyBox).toContain("card.agent_reply_attachment_reference")
  })

  test("overlay does not keep a direct-reply kind mirror", () => {
    const mirrorModule = ["direct", "reply", "kinds"].join("-")
    expect(existsSync(join(OVERLAY_ROOT, "src", "utils", `${mirrorModule}.ts`))).toBe(false)
    const source = overlaySourceText()
    expect(source).not.toContain("DIRECT_REPLY_AGENT_KINDS")
    expect(source).not.toContain("canReceiveDirectAgentReply")
    expect(source).not.toContain(mirrorModule)
    expect(source).not.toContain("structured 4xx")
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
