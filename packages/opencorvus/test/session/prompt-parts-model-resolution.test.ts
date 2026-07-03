import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { Provider } from "../../src/provider/provider"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MCP } from "../../src/mcp"
import { createUserMessage } from "../../src/session/prompt/parts"
import { AttachmentStore } from "../../src/storage/attachment-store"
import { tmpdir } from "../fixture/fixture"

describe("session prompt model resolution", () => {
  afterEach(() => {
    mock.restore()
  })

  test("swallows only Provider.ModelNotFoundError during optional variant lookup", async () => {
    spyOn(Agent, "get").mockResolvedValue({ name: "test-agent", variant: "review" } as any)
    spyOn(Provider, "getModel").mockRejectedValueOnce(
      new Provider.ModelNotFoundError({
        providerID: "missing-provider",
        modelID: "missing-model",
        suggestions: ["deepseek/deepseek-v4-pro"],
      }),
    )

    await using tmp = await tmpdir({ git: true })
    const message = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant", title: "prompt parts model not found" })
        return createUserMessage({
          sessionID: session.id,
          agent: "test-agent",
          model: { providerID: "missing-provider", modelID: "missing-model" },
          parts: [{ type: "text", text: "hello" }],
        })
      },
    })

    expect(message.info.variant).toBeUndefined()
  })

  test("rethrows non-ModelNotFoundError during optional variant lookup", async () => {
    spyOn(Agent, "get").mockResolvedValue({ name: "test-agent", variant: "review" } as any)
    spyOn(Provider, "getModel").mockRejectedValueOnce(new Error("provider registry unavailable"))

    await using tmp = await tmpdir({ git: true })
    await expect(
      Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ kind: "assistant", title: "prompt parts unexpected error" })
          return createUserMessage({
            sessionID: session.id,
            agent: "test-agent",
            model: { providerID: "missing-provider", modelID: "missing-model" },
            parts: [{ type: "text", text: "hello" }],
          })
        },
      }),
    ).rejects.toThrow("provider registry unavailable")
  })

  test("MCP resource read failures reject without persisting fabricated user text", async () => {
    spyOn(Agent, "get").mockResolvedValue({ name: "test-agent" } as any)
    spyOn(MCP, "readResource").mockRejectedValue(new Error("resource storage unavailable"))

    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant", title: "prompt parts MCP resource failure" })
        await expect(
          createUserMessage({
            sessionID: session.id,
            agent: "test-agent",
            model: { providerID: "openai", modelID: "gpt-5.2" },
            parts: [
              {
                type: "file",
                mime: "text/plain",
                filename: "resource.txt",
                url: "mcp://remote/resource.txt",
                source: { type: "resource", clientName: "remote", uri: "mcp://remote/resource.txt" },
              },
            ],
          }),
        ).rejects.toThrow("resource storage unavailable")

        const messages = await Session.messages({ sessionID: session.id })
        expect(
          messages
            .flatMap((message) => message.parts)
            .some((part) => {
              return part.type === "text" && part.text.includes("Failed to read MCP resource")
            }),
        ).toBe(false)
      },
    })
  })

  test("MCP resource blobs persist as attachment-backed file parts", async () => {
    spyOn(Agent, "get").mockResolvedValue({ name: "test-agent" } as any)
    spyOn(MCP, "readResource").mockResolvedValue({
      contents: [
        {
          uri: "mcp://remote/reference.png",
          mimeType: "image/png",
          blob: Buffer.from("png-bytes").toString("base64"),
        },
      ],
    } as any)

    await using tmp = await tmpdir({ git: true })
    let ownerProjectID = ""
    const message = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant", title: "prompt parts MCP blob resource" })
        ownerProjectID = Instance.project.id
        return await createUserMessage({
          sessionID: session.id,
          byteMaterializationProjectID: ownerProjectID,
          agent: "test-agent",
          model: { providerID: "openai", modelID: "gpt-5.2" },
          parts: [
            {
              type: "file",
              mime: "image/png",
              filename: "reference.png",
              url: "mcp://remote/reference.png",
              source: {
                type: "resource",
                clientName: "remote",
                uri: "mcp://remote/reference.png",
                text: { value: "mcp://remote/reference.png", start: 0, end: 26 },
              },
            },
          ],
        })
      },
    })

    const filePart = message.parts.find((part) => part.type === "file")
    expect(filePart?.type).toBe("file")
    expect(filePart?.url).toStartWith("/attachment/")
    expect(filePart?.url).not.toBe("mcp://remote/reference.png")
    const located = AttachmentStore.nameFromUrl(filePart!.url)
    expect(located).toBeTruthy()
    expect(located!.projectID).toBe(ownerProjectID)
    const bytes = await AttachmentStore.read(located!.projectID, located!.name)
    expect(bytes.toString()).toBe("png-bytes")
  })

  test("MCP resource blobs reject invalid base64 before attachment persistence", async () => {
    spyOn(Agent, "get").mockResolvedValue({ name: "test-agent" } as any)
    spyOn(MCP, "readResource").mockResolvedValue({
      contents: [
        {
          uri: "mcp://remote/corrupt.png",
          mimeType: "image/png",
          blob: "not base64!*",
        },
      ],
    } as any)

    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant", title: "prompt parts MCP corrupt blob resource" })
        await expect(
          createUserMessage({
            sessionID: session.id,
            byteMaterializationProjectID: Instance.project.id,
            agent: "test-agent",
            model: { providerID: "openai", modelID: "gpt-5.2" },
            parts: [
              {
                type: "file",
                mime: "image/png",
                filename: "corrupt.png",
                url: "mcp://remote/corrupt.png",
                source: {
                  type: "resource",
                  clientName: "remote",
                  uri: "mcp://remote/corrupt.png",
                },
              },
            ],
          }),
        ).rejects.toThrow("invalid base64 payload")

        const messages = await Session.messages({ sessionID: session.id })
        expect(messages.some((message) => message.parts.some((part) => part.type === "file"))).toBe(false)
      },
    })
  })

  test("MCP text resources persist text without unresolved mcp file parts", async () => {
    spyOn(Agent, "get").mockResolvedValue({ name: "test-agent" } as any)
    spyOn(MCP, "readResource").mockResolvedValue({
      contents: [
        {
          uri: "mcp://remote/readme",
          mimeType: "text/plain",
          text: "remote resource text",
        },
      ],
    } as any)

    await using tmp = await tmpdir({ git: true })
    const message = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant", title: "prompt parts MCP text resource" })
        return await createUserMessage({
          sessionID: session.id,
          agent: "test-agent",
          model: { providerID: "openai", modelID: "gpt-5.2" },
          parts: [
            {
              type: "file",
              mime: "text/plain",
              filename: "readme.txt",
              url: "mcp://remote/readme",
              source: {
                type: "resource",
                clientName: "remote",
                uri: "mcp://remote/readme",
                text: { value: "mcp://remote/readme", start: 0, end: 19 },
              },
            },
          ],
        })
      },
    })

    expect(message.parts.some((part) => part.type === "text" && part.text === "remote resource text")).toBe(true)
    expect(message.parts.some((part) => part.type === "file" && part.url === "mcp://remote/readme")).toBe(false)
  })
})
