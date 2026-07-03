import path from "path"
import fs from "node:fs/promises"
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { fileURLToPath, pathToFileURL } from "url"
import sharp from "sharp"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Session } from "../../src/session"
import { Message } from "../../src/session/message"
import { SessionPrompt } from "../../src/session/prompt"
import { AttachmentStore } from "../../src/storage/attachment-store"
import { Log } from "../../src/util/log"
import { LSP } from "../../src/lsp"
import { MCP } from "../../src/mcp"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

const providerModel: Provider.Model = {
  id: "test-model",
  providerID: "test",
  api: {
    id: "test-model",
    url: "https://example.com",
    npm: "@ai-sdk/openai",
  },
  name: "Test Model",
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: {
      text: true,
      audio: false,
      image: true,
      video: false,
      pdf: false,
    },
    output: {
      text: true,
      audio: false,
      image: false,
      video: false,
      pdf: false,
    },
    interleaved: false,
  },
  cost: {
    input: 0,
    output: 0,
    cache: {
      read: 0,
      write: 0,
    },
  },
  limit: {
    context: 0,
    input: 0,
    output: 0,
  },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

async function pngImage(width: number, height: number): Promise<Buffer> {
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
      `<rect width="${width}" height="${height}" fill="white"/>` +
      `<rect x="0" y="0" width="1" height="1" fill="black"/>` +
      `<rect x="${width - 1}" y="${height - 1}" width="1" height="1" fill="black"/>` +
      `<rect x="0" y="${height - 1}" width="1" height="1" fill="black"/>` +
      `<rect x="${width - 1}" y="${height - 1}" width="1" height="1" fill="black"/>` +
      `</svg>`,
  )
  return await sharp(svg).png().toBuffer()
}

describe("session.prompt missing file", () => {
  afterEach(() => {
    mock.restore()
  })

  test("materializes binary data URL file parts into AttachmentStore refs before persistence", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          coding: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "build" })
        const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])

        const msg = await SessionPrompt.prompt({
          sessionID: session.id,
          byteMaterializationProjectID: session.projectID,
          agent: "coding",
          noReply: true,
          parts: [
            { type: "text", text: "use the attached visual reference" },
            {
              type: "file",
              mime: "image/png",
              filename: "reference.png",
              url: `data:image/png;base64,${pngBytes.toString("base64")}`,
            },
          ],
        })

        if (msg.info.role !== "user") throw new Error("expected user message")
        expect(msg.parts.every((part) => typeof part.orderKey === "string" && part.orderKey.length > 0)).toBe(true)
        const stored = await Message.get({ sessionID: session.id, messageID: msg.info.id })
        expect(msg.parts.map((part) => part.orderKey)).toEqual(stored.parts.map((part) => part.orderKey))
        const filePart = stored.parts.find((part) => part.type === "file")
        if (!filePart || filePart.type !== "file") throw new Error("expected stored file part")

        expect(filePart.url.startsWith("data:")).toBe(false)
        const located = AttachmentStore.nameFromUrl(filePart.url)
        expect(located).toBeTruthy()
        const roundTrip = await AttachmentStore.read(located!.projectID, located!.name)
        expect(roundTrip.equals(pngBytes)).toBe(true)

        await Session.remove(session.id)
      },
    })
  }, 20000)

  test("rejects byte materialization when the prompt omits the owner project", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          coding: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "build" })

        await expect(
          SessionPrompt.prompt({
            sessionID: session.id,
            agent: "coding",
            noReply: true,
            parts: [
              {
                type: "file",
                mime: "image/png",
                filename: "reference.png",
                url: "data:image/png;base64,iVBORw0KGgo=",
              },
            ],
          }),
        ).rejects.toThrow("requires byteMaterializationProjectID")

        await Session.remove(session.id)
      },
    })
  }, 20000)

  test("materializes data URL file parts into the supplied owner project", async () => {
    await using ownerTmp = await tmpdir({ git: true })
    await using activeTmp = await tmpdir({
      git: true,
      config: {
        agent: {
          coding: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    let ownerProjectID = ""
    await Instance.provide({
      directory: ownerTmp.path,
      fn: async () => {
        ownerProjectID = Instance.project.id
      },
    })

    await Instance.provide({
      directory: activeTmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "build" })
        const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])

        const msg = await SessionPrompt.prompt({
          sessionID: session.id,
          byteMaterializationProjectID: ownerProjectID,
          agent: "coding",
          noReply: true,
          parts: [
            {
              type: "file",
              mime: "image/png",
              filename: "reference.png",
              url: `data:image/png;base64,${pngBytes.toString("base64")}`,
            },
          ],
        })

        const stored = await Message.get({ sessionID: session.id, messageID: msg.info.id })
        const filePart = stored.parts.find((part) => part.type === "file")
        if (!filePart || filePart.type !== "file") throw new Error("expected stored file part")
        const located = AttachmentStore.nameFromUrl(filePart.url)
        expect(located?.projectID).toBe(ownerProjectID)
        expect(await AttachmentStore.read(ownerProjectID, located!.name)).toEqual(pngBytes)

        await Session.remove(session.id)
      },
    })
  }, 20000)

  test("materializes MCP resource blobs into the supplied owner project", async () => {
    const readResource = spyOn(MCP, "readResource").mockResolvedValue({
      contents: [
        {
          blob: Buffer.from("resource-bytes").toString("base64"),
          mimeType: "image/png",
        },
      ],
    } as any)
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          coding: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "build" })

        const msg = await SessionPrompt.prompt({
          sessionID: session.id,
          byteMaterializationProjectID: session.projectID,
          agent: "coding",
          noReply: true,
          parts: [
            {
              type: "file",
              mime: "image/png",
              filename: "resource.png",
              url: "mcp://test/resource.png",
              source: {
                type: "resource",
                clientName: "test-client",
                uri: "resource://image",
                text: { value: "resource://image", start: 0, end: "resource://image".length },
              },
            },
          ],
        })

        expect(readResource).toHaveBeenCalledWith("test-client", "resource://image")
        const stored = await Message.get({ sessionID: session.id, messageID: msg.info.id })
        const filePart = stored.parts.find((part) => part.type === "file")
        if (!filePart || filePart.type !== "file") throw new Error("expected stored file part")
        const located = AttachmentStore.nameFromUrl(filePart.url)
        expect(located?.projectID).toBe(session.projectID)
        expect(await AttachmentStore.read(session.projectID, located!.name)).toEqual(Buffer.from("resource-bytes"))

        await Session.remove(session.id)
      },
    })
  }, 20000)

  test("materializes staged reference file parts before provider replay reads attachments", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          coding: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "build" })
        const pngBytes = await pngImage(16, 16)
        const original = await AttachmentStore.write(Instance.project.id, pngBytes, "image/png", "source.png")
        const worktreeDir = await fs.mkdtemp(path.join(tmp.path, "worktree-"))
        const staged = await AttachmentStore.stageToWorktree(Instance.project.id, [original], worktreeDir)
        const originalLocation = AttachmentStore.nameFromUrl(original.url)
        if (!originalLocation) throw new Error("expected original attachment location")
        const originalAbs = AttachmentStore.resolveAbsolute(originalLocation.projectID, originalLocation.name)
        if (!originalAbs) throw new Error("expected original attachment path")
        await fs.rm(originalAbs, { force: true })
        await fs.rm(`${originalAbs}.metadata.json`, { force: true })

        const [stagedPart] = AttachmentStore.filePartsFromStagedReferences(staged)
        const msg = await SessionPrompt.prompt({
          sessionID: session.id,
          byteMaterializationProjectID: session.projectID,
          agent: "coding",
          noReply: true,
          parts: [{ type: "text", text: "use the staged reference" }, stagedPart],
        })

        if (msg.info.role !== "user") throw new Error("expected user message")
        const stored = await Message.get({ sessionID: session.id, messageID: msg.info.id })
        const filePart = stored.parts.find((part) => part.type === "file")
        if (!filePart || filePart.type !== "file") throw new Error("expected stored file part")

        expect(filePart.url.startsWith("file:")).toBe(false)
        const recreated = AttachmentStore.nameFromUrl(filePart.url)
        expect(recreated).toBeTruthy()
        expect(await AttachmentStore.read(recreated!.projectID, recreated!.name)).toEqual(pngBytes)

        const modelMessages = await Message.toModelMessages([stored], providerModel)
        const wire = JSON.stringify(modelMessages)
        expect(wire).toContain(`data:image/png;base64,${pngBytes.toString("base64")}`)

        await Session.remove(session.id)
      },
    })
  }, 20000)

  test("materializes decodable text data URL file parts after injecting text content", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          coding: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "build" })
        const markdown = "## Acceptance\nUse the existing card tokens."

        const msg = await SessionPrompt.prompt({
          sessionID: session.id,
          byteMaterializationProjectID: session.projectID,
          agent: "coding",
          noReply: true,
          parts: [
            {
              type: "file",
              mime: "text/markdown",
              filename: "notes.md",
              url: `data:text/markdown;base64,${Buffer.from(markdown).toString("base64")}`,
            },
          ],
        })

        if (msg.info.role !== "user") throw new Error("expected user message")
        const stored = await Message.get({ sessionID: session.id, messageID: msg.info.id })
        expect(stored.parts.some((part) => part.type === "text" && part.text === markdown)).toBe(true)
        const filePart = stored.parts.find((part) => part.type === "file")
        if (!filePart || filePart.type !== "file") throw new Error("expected stored file part")
        expect(filePart.url.startsWith("data:")).toBe(false)
        expect(AttachmentStore.nameFromUrl(filePart.url)).toBeTruthy()

        await Session.remove(session.id)
      },
    })
  }, 20000)

  test("rejects malformed data URL file parts before message persistence", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          coding: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "build" })

        await expect(
          SessionPrompt.prompt({
            sessionID: session.id,
            byteMaterializationProjectID: session.projectID,
            agent: "coding",
            noReply: true,
            parts: [
              {
                type: "file",
                mime: "image/png",
                filename: "broken.png",
                url: "data:image/png;base64,not base64!*",
              },
            ],
          }),
        ).rejects.toThrow(/invalid base64 payload/)

        const messages: Message.WithParts[] = []
        for await (const item of Message.stream(session.id)) messages.push(item)
        expect(messages).toEqual([])

        await Session.remove(session.id)
      },
    })
  }, 20000)

  test("rejects prompt creation when a local file part is missing", async () => {
    spyOn(Provider, "getModel").mockResolvedValue({ providerID: "openai", modelID: "gpt-5.2" } as any)
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          coding: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant" })

        const missing = path.join(tmp.path, "does-not-exist.ts")
        await expect(
          SessionPrompt.prompt({
            sessionID: session.id,
            agent: "coding",
            noReply: true,
            parts: [
              { type: "text", text: "please review @does-not-exist.ts" },
              {
                type: "file",
                mime: "text/plain",
                url: pathToFileURL(missing).href,
                filename: "does-not-exist.ts",
              },
            ],
          }),
        ).rejects.toThrow("does-not-exist.ts")

        const messages = await Session.messages({ sessionID: session.id })
        expect(
          messages.some((message) =>
            message.parts.some(
              (part) => part.type === "text" && part.text.includes("Host-provided file context failed to read"),
            ),
          ),
        ).toBe(false)

        await Session.remove(session.id)
      },
    })
  }, 20000)

  test("rejects malformed local text file ranges without persisting downgraded content", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "range.ts"), "one\ntwo\nthree\n")
      },
      config: {
        agent: {
          coding: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const cases: Array<{ query: string; message: RegExp }> = [
          { query: "start=3x", message: /file range start must be a positive integer/ },
          { query: "start=0", message: /file range start must be a positive integer/ },
          { query: "start=3&end=2", message: /file range end must be greater than or equal to start/ },
        ]

        for (const item of cases) {
          const session = await Session.create({ kind: "assistant" })
          const file = path.join(tmp.path, "range.ts")
          await expect(
            SessionPrompt.prompt({
              sessionID: session.id,
              byteMaterializationProjectID: session.projectID,
              agent: "coding",
              noReply: true,
              parts: [
                {
                  type: "file",
                  mime: "text/plain",
                  url: `${pathToFileURL(file).href}?${item.query}`,
                  filename: "range.ts",
                },
              ],
            }),
          ).rejects.toThrow(item.message)

          const messages = await Session.messages({ sessionID: session.id })
          expect(messages.some((message) => message.parts.some((part) => part.type === "text"))).toBe(false)
          await Session.remove(session.id)
        }
      },
    })
  }, 20000)

  test("rejects local text file symbol range when LSP document symbols fail", async () => {
    spyOn(LSP, "documentSymbol").mockRejectedValueOnce(new Error("symbol server unavailable"))
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "symbol.ts"), "export function target() {}\n")
      },
      config: {
        agent: {
          coding: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant" })
        const file = path.join(tmp.path, "symbol.ts")
        await expect(
          SessionPrompt.prompt({
            sessionID: session.id,
            byteMaterializationProjectID: session.projectID,
            agent: "coding",
            noReply: true,
            parts: [
              {
                type: "file",
                mime: "text/plain",
                url: `${pathToFileURL(file).href}?start=1&end=1`,
                filename: "symbol.ts",
              },
            ],
          }),
        ).rejects.toThrow("symbol server unavailable")

        const messages = await Session.messages({ sessionID: session.id })
        expect(messages.some((message) => message.parts.some((part) => part.type === "text"))).toBe(false)
        await Session.remove(session.id)
      },
    })
  }, 20000)

  test("keeps stored part order stable when file resolution is async", async () => {
    spyOn(Provider, "getModel").mockResolvedValue({ providerID: "openai", modelID: "gpt-5.2" } as any)
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "still-present.ts"), "const value = 42\n")
      },
      config: {
        agent: {
          coding: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant" })

        const file = path.join(tmp.path, "still-present.ts")
        const msg = await SessionPrompt.prompt({
          sessionID: session.id,
          byteMaterializationProjectID: session.projectID,
          agent: "coding",
          noReply: true,
          parts: [
            {
              type: "file",
              mime: "text/plain",
              url: pathToFileURL(file).href,
              filename: "still-present.ts",
            },
            { type: "text", text: "after-file" },
          ],
        })

        if (msg.info.role !== "user") throw new Error("expected user message")

        const stored = await Message.get({
          sessionID: session.id,
          messageID: msg.info.id,
        })
        const text = stored.parts.filter((part) => part.type === "text").map((part) => part.text)

        expect(text[0]?.startsWith("Host-provided file context (not a model tool call):")).toBe(true)
        expect(text[1]).toContain("const value = 42")
        expect(text[2]).toBe("after-file")

        await Session.remove(session.id)
      },
    })
  }, 20000)
})

describe("session.prompt special characters", () => {
  test("handles filenames with # character", async () => {
    const prev = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = "test-openai-key"

    try {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await Bun.write(path.join(dir, "file#name.txt"), "special content\n")
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ kind: "assistant" })
          const template = "Read @file#name.txt"
          const parts = await SessionPrompt.resolvePromptParts(template)
          const fileParts = parts.filter((part) => part.type === "file")

          expect(fileParts.length).toBe(1)
          expect(fileParts[0].filename).toBe("file#name.txt")
          expect(fileParts[0].url).toContain("%23")

          const decodedPath = fileURLToPath(fileParts[0].url)
          expect(decodedPath).toBe(path.join(tmp.path, "file#name.txt"))

          const message = await SessionPrompt.prompt({
            sessionID: session.id,
            byteMaterializationProjectID: session.projectID,
            model: { providerID: "openai", modelID: "gpt-5.2" },
            parts,
            noReply: true,
          })
          const stored = await Message.get({ sessionID: session.id, messageID: message.info.id })
          const textParts = stored.parts.filter((part) => part.type === "text")
          const hasContent = textParts.some((part) => part.text.includes("special content"))
          expect(hasContent).toBe(true)

          await Session.remove(session.id)
        },
      })
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = prev
    }
  }, 20000)
})

describe("session.prompt agent variant", () => {
  test("applies agent variant only when using agent model", async () => {
    const prev = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = "test-openai-key"

    try {
      await using tmp = await tmpdir({
        git: true,
        config: {
          agent: {
            coding: {
              model: "openai/gpt-5.2",
              variant: "xhigh",
            },
          },
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ kind: "assistant" })

          const other = await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "coding",
            model: { providerID: "opencorvus", modelID: "kimi-k2.5-free" },
            noReply: true,
            parts: [{ type: "text", text: "hello" }],
          })
          if (other.info.role !== "user") throw new Error("expected user message")
          expect(other.info.variant).toBeUndefined()

          const match = await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "coding",
            noReply: true,
            parts: [{ type: "text", text: "hello again" }],
          })
          if (match.info.role !== "user") throw new Error("expected user message")
          expect(match.info.model).toEqual({ providerID: "openai", modelID: "gpt-5.2" })
          expect(match.info.variant).toBe("xhigh")

          const override = await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "coding",
            noReply: true,
            variant: "high",
            parts: [{ type: "text", text: "hello third" }],
          })
          if (override.info.role !== "user") throw new Error("expected user message")
          expect(override.info.variant).toBe("high")

          await Session.remove(session.id)
        },
      })
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = prev
    }
  }, 20000)
})

describe("session.prompt agent contract", () => {
  test("fails fast when an explicit agent does not exist", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant" })

        await expect(
          SessionPrompt.prompt({
            sessionID: session.id,
            agent: "assistant",
            model: { providerID: "openai", modelID: "gpt-5.2" },
            noReply: true,
            parts: [{ type: "text", text: "hello" }],
          }),
        ).rejects.toThrow("Unknown agent: assistant")

        await Session.remove(session.id)
      },
    })
  }, 20000)

  test("persists complete system mode on user messages", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant" })
        const msg = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "general",
          model: { providerID: "openai", modelID: "gpt-5.2" },
          noReply: true,
          system: "COMPLETE CONTROL PROMPT",
          systemMode: "complete",
          parts: [{ type: "text", text: "hello" }],
        })

        if (msg.info.role !== "user") throw new Error("expected user message")
        expect(msg.info.systemMode).toBe("complete")

        const stored = await Message.get({ sessionID: session.id, messageID: msg.info.id })
        if (stored.info.role !== "user") throw new Error("expected stored user message")
        expect(stored.info.systemMode).toBe("complete")

        await Session.remove(session.id)
      },
    })
  }, 20000)

  test("rejects workflow build agent outside complete system mode", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant" })

        await expect(
          SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            model: { providerID: "openai", modelID: "gpt-5.2" },
            noReply: true,
            parts: [{ type: "text", text: "hello" }],
          }),
        ).rejects.toThrow('workflow build agent requires systemMode="complete"')

        await Session.remove(session.id)
      },
    })
  }, 20000)
})
