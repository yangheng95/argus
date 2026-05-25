/**
 * Session.snapshotLatestAssistant — fact-check idempotency key source.
 *
 * Spec §3.3: snapshot the latest assistant message in a target session
 * before invoking fact-check; reject when the target is still streaming
 * (no hash drift). Used by orchestrator's fact_check tool input gate.
 */
import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionStatus } from "../../src/session/status"
import { Identifier } from "../../src/id/id"

async function createSessionWithAssistantText(text: string): Promise<string> {
  const session = await Session.create({ kind: "orchestrator" })
  // User turn first (so the assistant has something to follow).
  const userID = Identifier.ascending("message")
  await Session.updateMessage({
    id: userID,
    sessionID: session.id,
    role: "user",
    time: { created: Date.now() },
    agent: "user",
    model: { providerID: "test", modelID: "test" },
  } as any)

  // Assistant message.
  const assistantID = Identifier.ascending("message")
  await Session.updateMessage({
    id: assistantID,
    sessionID: session.id,
    role: "assistant",
    parentID: userID,
    modelID: "test",
    providerID: "test",
    agent: "build",
    path: { cwd: "/tmp/fc-test", root: "/tmp/fc-test" },
    time: { created: Date.now() },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  } as any)

  // Single text part on the assistant message.
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID: assistantID,
    sessionID: session.id,
    type: "text",
    text,
  } as any)

  return session.id
}

describe("Session.snapshotLatestAssistant", () => {
  test("returns finished=false with reason='streaming' when SessionStatus is streaming", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = await createSessionWithAssistantText("Hello world from the build agent.")
        SessionStatus.set(sessionID, { type: "streaming" })
        const snap = await Session.snapshotLatestAssistant(sessionID)
        expect(snap.finished).toBe(false)
        expect(snap.reason).toBe("streaming")
        expect(snap.messageID).toBeUndefined()
      },
    })
  })

  test("returns finished=false with reason='no_assistant_message' on an empty session", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "orchestrator" })
        SessionStatus.set(session.id, { type: "idle" })
        const snap = await Session.snapshotLatestAssistant(session.id)
        expect(snap.finished).toBe(false)
        expect(snap.reason).toBe("no_assistant_message")
      },
    })
  })

  test("returns finished=true with stable messageID + contentHash on a terminal session", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = await createSessionWithAssistantText(
          "Recommended library: react@19. API doc says useFormState() returns [state, dispatch].",
        )
        SessionStatus.set(sessionID, { type: "idle" })
        const snap1 = await Session.snapshotLatestAssistant(sessionID)
        expect(snap1.finished).toBe(true)
        expect(snap1.messageID).toMatch(/^msg_/)
        expect(snap1.contentHash).toMatch(/^[0-9a-f]{64}$/)

        // Repeat — same content → same hash (idempotency key is stable).
        const snap2 = await Session.snapshotLatestAssistant(sessionID)
        expect(snap2.messageID).toBe(snap1.messageID)
        expect(snap2.contentHash).toBe(snap1.contentHash)
      },
    })
  })

  test("different content yields different contentHash", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionA = await createSessionWithAssistantText("Claim A about library v1.")
        const sessionB = await createSessionWithAssistantText("Claim B about library v2.")
        SessionStatus.set(sessionA, { type: "idle" })
        SessionStatus.set(sessionB, { type: "idle" })
        const snapA = await Session.snapshotLatestAssistant(sessionA)
        const snapB = await Session.snapshotLatestAssistant(sessionB)
        expect(snapA.contentHash).not.toBe(snapB.contentHash)
      },
    })
  })
})
