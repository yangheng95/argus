import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { CodexCLIExecutor } from "../../src/executor/codex-cli"

describe("external cli executors", () => {
  test("codex cli provider parses jsonl events", async () => {
    const script = [
      "console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread_1' }))",
      "console.log(JSON.stringify({ type: 'turn.started' }))",
      "console.log(JSON.stringify({ type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: 'hi' } }))",
      "console.log(JSON.stringify({ type: 'turn.completed', usage: { output_tokens: 1 } }))",
    ].join(";")
    const file = await writeScript(script)
    const provider = CodexCLIExecutor.create({
      command: [runner(), file],
    })

    const out = []
    for await (const item of provider.run({
      model: "gpt-5-codex",
      prompt: "say hi",
    })) {
      out.push(item)
    }

    expect(out).toEqual([
      {
        type: "progress",
        phase: "init",
        summary: "thread.started",
        meta: { type: "thread.started", thread_id: "thread_1" },
      },
      { type: "progress", phase: "responding", summary: "turn.started", meta: { type: "turn.started" } },
      { type: "text_delta", text: "hi" },
      {
        type: "progress",
        phase: "turn_completed",
        summary: "turn.completed",
        meta: { type: "turn.completed", usage: { output_tokens: 1 } },
      },
      { type: "done", sessionID: "thread_1", output: "hi" },
    ])
  })
})

function runner() {
  return Bun.which("node") ?? process.execPath
}

async function writeScript(source: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-cli-"))
  const file = path.join(dir, "tool.js")
  await fs.writeFile(file, source, "utf8")
  return file
}
