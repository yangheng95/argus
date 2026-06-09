import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { AttachmentStore } from "../../src/storage/attachment-store"
import { tmpdir } from "../fixture/fixture"

/**
 * 2026-04-30 — overlay-web-benchmark exposed silent multimodal drops:
 * dashscope-coding (kimi-k2.5) accepts text only, but the orchestrator
 * was inlining image bytes into every wake; the openai-compatible
 * provider wrapper either stripped them or replaced them with an inline
 * "ERROR: Cannot read..." text part, leaving the agent to confabulate
 * visual context it never received.
 *
 * Fix is a capability filter on `inlineFileParts`: the resolved model's
 * `capabilities.input.{image,pdf,audio,video}` flags decide which
 * multimodal attachments survive into the prompt parts. This regression
 * pins the contract.
 */

describe("AttachmentStore.inlineFileParts — capability gate", () => {
  test("drops image part when model lacks input.image", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const png = await AttachmentStore.write(
          projectID,
          Buffer.from([0x89, 0x50, 0x4e, 0x47]),
          "image/png",
          "screenshot.png",
        )
        const parts = await AttachmentStore.inlineFileParts([png], {
          capabilities: { input: { text: true, image: false, pdf: false, audio: false, video: false } },
          agent: "build",
        })
        expect(parts).toHaveLength(0)
      },
    })
  })

  test("keeps image part when model accepts input.image", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const png = await AttachmentStore.write(
          projectID,
          Buffer.from([0x89, 0x50, 0x4e, 0x47]),
          "image/png",
          "shot.png",
        )
        const parts = await AttachmentStore.inlineFileParts([png], {
          capabilities: { input: { text: true, image: true, pdf: false, audio: false, video: false } },
          agent: "orchestrator",
        })
        expect(parts).toHaveLength(1)
        expect(parts[0].mime).toBe("image/png")
      },
    })
  })

  test("drops pdf when caps.input.pdf=false but keeps image when caps.input.image=true", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const png = await AttachmentStore.write(projectID, Buffer.from([0x89, 0x50]), "image/png", "a.png")
        const pdf = await AttachmentStore.write(
          projectID,
          Buffer.from([0x25, 0x50, 0x44, 0x46]),
          "application/pdf",
          "b.pdf",
        )
        const parts = await AttachmentStore.inlineFileParts([png, pdf], {
          capabilities: { input: { text: true, image: true, pdf: false, audio: false, video: false } },
        })
        expect(parts).toHaveLength(1)
        expect(parts[0].mime).toBe("image/png")
      },
    })
  })

  test("no opts.capabilities → no filtering (caller responsibility)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const png = await AttachmentStore.write(projectID, Buffer.from([0x89]), "image/png", "x.png")
        const parts = await AttachmentStore.inlineFileParts([png])
        expect(parts).toHaveLength(1)
      },
    })
  })
})
