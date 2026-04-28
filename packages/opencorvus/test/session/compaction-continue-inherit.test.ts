import { describe, expect, test } from "bun:test"
import "../../src/session/prompt"
import { SessionCompaction } from "../../src/session/compaction"
import type { Message } from "../../src/session/message"

/**
 * Phase B of specs/new-arch/2026-04-28-structured-output-systemic-fix.md:
 * the synthetic user message that `SessionCompaction.process()` enqueues
 * after an auto-compaction must inherit the original user turn's
 * `format / system / tools / variant / extra`. Without this the next loop
 * iteration sees `format=undefined`, `resolveTools` skips the
 * StructuredOutput injection (loop.ts:485-492) and the stage agent's
 * core system prompt (loop.ts:527-530) is dropped — exactly the failure
 * mode observed on integrity reviewer step 3 (toolNames lacks
 * StructuredOutput) and on the live build session in
 * tsk_dd200fc58001606QiIAbsibN5r at 03:12:44Z.
 */
describe("SessionCompaction.buildContinueUserMessage", () => {
  function baseUser(overrides: Partial<Message.User> = {}): Message.User {
    return {
      id: "msg_user_base",
      role: "user",
      sessionID: "ses_test",
      time: { created: 1 },
      agent: "integrity",
      model: { providerID: "alibaba-coding-plan-cn", modelID: "kimi-k2.5" },
      ...overrides,
    } as Message.User
  }

  test("inherits format=json_schema so the next turn re-injects StructuredOutput", () => {
    const fmt: Message.User["format"] = {
      type: "json_schema",
      schema: { type: "object", properties: { summary: { type: "string" } } },
      retryCount: 2,
    }
    const cont = SessionCompaction.buildContinueUserMessage({
      userMessage: baseUser({ format: fmt }),
      sessionID: "ses_test",
      now: 999,
    })
    expect(cont.format).toEqual(fmt)
    expect(cont.role).toBe("user")
    expect(cont.sessionID).toBe("ses_test")
    expect(cont.time.created).toBe(999)
    expect(cont.agent).toBe("integrity")
    expect(cont.model.modelID).toBe("kimi-k2.5")
  })

  test("inherits system / tools / variant / extra verbatim", () => {
    const cont = SessionCompaction.buildContinueUserMessage({
      userMessage: baseUser({
        system: "You are integrity reviewer.",
        tools: { read_file: true, search_code: false },
        variant: "v2",
        extra: { taskID: "tsk_x", surface: "panel" },
      }),
      sessionID: "ses_test",
      now: 1234,
    })
    expect(cont.system).toBe("You are integrity reviewer.")
    expect(cont.tools).toEqual({ read_file: true, search_code: false })
    expect(cont.variant).toBe("v2")
    expect(cont.extra).toEqual({ taskID: "tsk_x", surface: "panel" })
  })

  test("omits optional fields when the source did not have them", () => {
    const cont = SessionCompaction.buildContinueUserMessage({
      userMessage: baseUser(),
      sessionID: "ses_test",
      now: 5,
    })
    expect("format" in cont).toBe(false)
    expect("system" in cont).toBe(false)
    expect("tools" in cont).toBe(false)
    expect("variant" in cont).toBe(false)
    expect("extra" in cont).toBe(false)
  })

  test("each call mints a fresh message id (does not reuse the source id)", () => {
    const a = SessionCompaction.buildContinueUserMessage({
      userMessage: baseUser(),
      sessionID: "ses_test",
      now: 1,
    })
    const b = SessionCompaction.buildContinueUserMessage({
      userMessage: baseUser(),
      sessionID: "ses_test",
      now: 2,
    })
    expect(a.id).not.toBe("msg_user_base")
    expect(a.id).not.toBe(b.id)
  })
})
