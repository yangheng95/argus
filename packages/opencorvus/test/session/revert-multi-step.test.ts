import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Filesystem } from "../../src/util/filesystem"
import { Snapshot } from "../../src/snapshot"
import { Session } from "../../src/session"
import { SessionRevert } from "../../src/session/revert"
import { Message } from "../../src/session/message"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { Identifier } from "../../src/id/id"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

// What this pins
// ----------------
// The contract behind the overlay benchmark's "revert to any step" handle:
// each agent step records the pre-edit Snapshot.track() hash on a PatchPart,
// edits files, finishes the message. Reverting at message k must (1) restore
// files to that step's pre-edit state via Snapshot.revert and (2) leave the
// message graph trimmable by SessionRevert.cleanup. Before fix(snapshot),
// hourly Snapshot.cleanup() shredded those hashes — so revert to any step
// older than a 1h boundary silently produced wrong files. Without per-step
// snapshots surviving, this test would fail at the first revert.
describe("session revert at any prior step", () => {
  test("each captured step is independently reachable via SessionRevert", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = (await Session.create({ kind: "assistant" })).id

        const filename = path.join(tmp.path, "doc.txt")
        await Filesystem.write(filename, "S0")

        // Each agent step: user msg → assistant msg with a PatchPart capturing
        // the worktree state BEFORE the edits — same shape session/processor.ts
        // emits in production. We then mutate the file so successive steps
        // diverge.
        type Step = { messageID: string; expectedFile: string }
        const steps: Step[] = []
        for (let i = 1; i <= 4; i++) {
          // User
          const userMsg = await Session.updateMessage({
            id: Identifier.ascending("message"),
            role: "user",
            sessionID,
            agent: "default",
            model: { providerID: "openai", modelID: "gpt-4" },
            time: { created: Date.now() },
          })
          await Session.updatePart({
            id: Identifier.ascending("part"),
            messageID: userMsg.id,
            sessionID,
            type: "text",
            text: `step-${i} request`,
          })

          // Pre-edit snapshot: this is the hash session/revert.ts will replay
          // through Snapshot.revert when the user reverts past this step.
          const preEditHash = await Snapshot.track()
          expect(preEditHash).toBeTruthy()

          // Assistant + a PatchPart pinning the pre-edit state.
          const assistantMsg: Message.Assistant = {
            id: Identifier.ascending("message"),
            role: "assistant",
            sessionID,
            mode: "default",
            agent: "default",
            path: { cwd: tmp.path, root: tmp.path },
            cost: 0,
            tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: "gpt-4",
            providerID: "openai",
            parentID: userMsg.id,
            time: { created: Date.now() },
            finish: "end_turn",
          }
          await Session.updateMessage(assistantMsg)
          await Session.updatePart({
            id: Identifier.ascending("part"),
            messageID: assistantMsg.id,
            sessionID,
            type: "text",
            text: `step-${i} reply`,
          })
          await Session.updatePart({
            id: Identifier.ascending("part"),
            messageID: assistantMsg.id,
            sessionID,
            type: "patch",
            hash: preEditHash!,
            files: [filename.replaceAll("\\", "/")],
          })

          // The edit this step makes. The file the user would see after
          // step i is "S<i>"; reverting the i-th step means returning to
          // "S<i-1>".
          await Filesystem.write(filename, `S${i}`)

          steps.push({
            messageID: userMsg.id,
            expectedFile: `S${i - 1}`,
          })
        }

        // After all 4 steps, current worktree must show the latest edit.
        expect(await fs.readFile(filename, "utf-8")).toBe("S4")
        const beforeMessages = await Session.messages({ sessionID })
        expect(beforeMessages.length).toBe(8) // 4 user + 4 assistant

        // Walk backwards and revert to each captured step. After revert+cleanup,
        // the file must show the pre-edit content for that step AND messages
        // strictly after that step's user message must be removed.
        for (let cursor = steps.length - 1; cursor >= 0; cursor--) {
          const target = steps[cursor]

          await SessionRevert.revert({ sessionID, messageID: target.messageID })
          const afterRevert = await Session.get(sessionID)
          expect(afterRevert.revert).toBeDefined()

          // Files: pre-edit content for this step.
          expect(await fs.readFile(filename, "utf-8")).toBe(target.expectedFile)

          // Conversation: cleanup truncates messages >= revert.messageID.
          await SessionRevert.cleanup(afterRevert)
          const surviving = await Session.messages({ sessionID })
          // surviving = all messages with id < target.messageID
          // = the (cursor) user msgs + (cursor) assistant msgs from earlier steps.
          expect(surviving.length).toBe(cursor * 2)
          for (const msg of surviving) {
            expect(msg.info.id < target.messageID).toBe(true)
          }

          // Restore worktree forward so the next revert iteration starts from
          // a divergent state — proves the prior snapshot stays restorable
          // even after we drift away from it.
          await Filesystem.write(filename, `drift-${cursor}`)
        }
      },
    })
  })
})
