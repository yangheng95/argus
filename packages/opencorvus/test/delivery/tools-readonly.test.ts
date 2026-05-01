import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createDeliveryTools } from "../../src/delivery/tools"
import { Instance } from "../../src/project/instance"

const repoRoot = path.resolve(import.meta.dir, "../../../..")

describe("delivery review-only tool surface", () => {
  test("does not expose file mutation tools", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "opencorvus-delivery-readonly-"))
    try {
      await Instance.provide({
        directory: dir,
        fn: () => {
          const tools = createDeliveryTools({ taskID: "tsk_readonly" })
          expect(Object.keys(tools)).not.toContain("write_file")
          expect(Object.keys(tools)).not.toContain("edit_file")
          expect(Object.keys(tools)).toContain("run_command")
          expect(Object.keys(tools)).toContain("screenshot")
          expect(Object.keys(tools)).toContain("submit_next_task")
        },
      })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("core prompt routes repair through rejection instead of file edits", async () => {
    const prompt = await Bun.file(
      path.join(repoRoot, "packages/opencorvus/src/prompt/core/delivery-core.txt"),
    ).text()

    expect(prompt).toContain("review-only acceptance gate")
    expect(prompt).toContain("MUST NOT edit the deliverable")
    expect(prompt).toContain("orchestrator can send the affected goal(s) back")
    expect(prompt).not.toContain("write_file")
    expect(prompt).not.toContain("edit_file")
    expect(prompt).not.toContain("Fix aggressively")
  })
})
