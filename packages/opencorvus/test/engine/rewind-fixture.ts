import { expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Message } from "../../src/session/message"
import { Snapshot } from "../../src/snapshot"
import { Database } from "../../src/storage/db"
import { Filesystem } from "../../src/util/filesystem"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export type RewindStep = {
  userMessageID: string
  expectedBeforeStep: string
}

export type RewindScenario = {
  taskID: string
  sessionID: string
  filename: string
  steps: RewindStep[]
  cursorAfterSecondStep: number
}

export async function createRewindScenario(root: string): Promise<RewindScenario> {
  const sessionID = (await Session.create({ kind: "root", title: "rewind root" })).id
  const taskID = Identifier.ascending("task")
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: Instance.project.id,
        session_id: sessionID,
        source: "test",
        title: "rewind task",
        request: "rewind task",
        priority: "normal",
        time_created: now,
        time_updated: now,
      })
      .run(),
  )

  const filename = path.join(root, "doc.txt")
  await Filesystem.write(filename, "S0")

  const steps: RewindStep[] = []
  let cursorAfterSecondStep = 0

  for (let i = 1; i <= 4; i++) {
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
    await sleep(2)

    const preEditHash = await Snapshot.track()
    expect(preEditHash).toBeTruthy()

    const assistantMsg: Message.Assistant = {
      id: Identifier.ascending("message"),
      role: "assistant",
      sessionID,
      mode: "default",
      agent: "default",
      path: { cwd: root, root },
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
    await sleep(2)
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: assistantMsg.id,
      sessionID,
      type: "patch",
      hash: preEditHash!,
      files: [filename.replaceAll("\\", "/")],
    })

    await Filesystem.write(filename, `S${i}`)
    if (i === 2) {
      cursorAfterSecondStep = Date.now()
      await sleep(2)
    }

    steps.push({
      userMessageID: userMsg.id,
      expectedBeforeStep: `S${i - 1}`,
    })
  }

  expect(await fs.readFile(filename, "utf-8")).toBe("S4")
  return { taskID, sessionID, filename, steps, cursorAfterSecondStep }
}
