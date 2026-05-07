import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createDeliveryTools } from "../../src/delivery/tools"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { AttachmentStore } from "../../src/storage/attachment-store"

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
          expect(Object.keys(tools)).toContain("inspect_delivery_context")
          expect(Object.keys(tools)).toContain("compare_visual_artifacts")
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
    expect(prompt).not.toContain(" or criteria")
  })

  test("delivery agent exposes no registry tools", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "opencorvus-delivery-agent-readonly-"))
    try {
      await Instance.provide({
        directory: dir,
        fn: async () => {
          const agent = await Agent.get("delivery")
          expect(agent?.description).toContain("without editing deliverables")
          expect(agent?.tools).toEqual({ include: [] })
        },
      })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("compare_visual_artifacts loads image bytes only when the tool is called", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "opencorvus-delivery-visual-tool-"))
    try {
      await Bun.$`git init`.cwd(dir).quiet()
      await Instance.provide({
        directory: dir,
        fn: async () => {
          const rendered = await AttachmentStore.write(Instance.project.id, Buffer.from("rendered"), "image/png", "rendered.png")
          const reference = await AttachmentStore.write(Instance.project.id, Buffer.from("reference"), "image/png", "reference.png")
          const tools = createDeliveryTools({
            taskID: "tsk_visual_tool",
            attachments: [
              { ...rendered, intent: "rendered_output" },
              { ...reference, intent: "visual_reference" },
            ],
          })

          const output = await tools.compare_visual_artifacts.execute!(
            { include_all_references: false },
            {} as any,
          ) as any

          expect(output.text).toContain("rendered_output")
          expect(output.attachments).toHaveLength(2)
          expect(output.attachments[0].url).toStartWith("data:image/png;base64,")
        },
      })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
