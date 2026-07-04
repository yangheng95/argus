import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

const server = new McpServer({ name: "package-mcp-test", version: "1.0.0" })
const RAW_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="

server.registerTool(
  "snapshot",
  {
    description: "Return scoped package MCP evidence.",
    inputSchema: {
      label: z.string().optional(),
    },
  },
  async ({ label }) => ({
    content: [
      {
        type: "text" as const,
        text: `package-mcp-snapshot:${label ?? ""}:${process.cwd()}`,
      },
    ],
  }),
)

server.registerPrompt(
  "inspect",
  {
    description: "Return scoped package MCP prompt evidence.",
    argsSchema: {
      label: z.string().optional(),
    },
  },
  ({ label }) => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `package-mcp-prompt:${label ?? ""}:${process.cwd()}`,
        },
      },
    ],
  }),
)

server.registerPrompt("image", { description: "Return binary prompt content." }, () => ({
  messages: [
    {
      role: "user" as const,
      content: {
        type: "image" as const,
        data: "iVBORw0KGgo=",
        mimeType: "image/png",
      },
    },
  ],
}))

server.registerPrompt("audio", { description: "Return audio prompt content." }, () => ({
  messages: [
    {
      role: "user" as const,
      content: {
        type: "audio" as const,
        data: "UklGRg==",
        mimeType: "audio/wav",
      },
    },
  ],
}))

server.registerPrompt("data-text", { description: "Return inline base64 inside text content." }, () => ({
  messages: [
    {
      role: "user" as const,
      content: {
        type: "text" as const,
        text: "data:image/png;base64,UE5H",
      },
    },
  ],
}))

server.registerPrompt("raw-data-text", { description: "Return raw base64 inside text content." }, () => ({
  messages: [
    {
      role: "user" as const,
      content: {
        type: "text" as const,
        text: RAW_PNG_BASE64,
      },
    },
  ],
}))

server.registerPrompt("text-number", { description: "Return non-string prompt text." }, () => ({
  messages: [
    {
      role: "user" as const,
      content: {
        type: "text" as const,
        text: 42,
      } as any,
    },
  ],
}))

server.registerPrompt("text-extra-field", { description: "Return text content with an unsupported field." }, () => ({
  messages: [
    {
      role: "user" as const,
      content: {
        type: "text" as const,
        text: "unsupported field should fail",
        secret: "hidden",
      } as any,
    },
  ],
}))

server.registerPrompt("video", { description: "Return an unsupported prompt content type." }, () => ({
  messages: [
    {
      role: "user" as const,
      content: {
        type: "video",
        url: "https://example.test/video.mp4",
      } as any,
    },
  ],
}))

server.registerPrompt("resource-data-text", { description: "Return inline base64 inside embedded resource text." }, () => ({
  messages: [
    {
      role: "user" as const,
      content: {
        type: "resource" as const,
        resource: {
          uri: "package://inline-resource",
          mimeType: "text/plain",
          text: "data:image/png;base64,UE5H",
        },
      },
    },
  ],
}))

server.registerPrompt("resource-raw-data-text", { description: "Return raw base64 inside embedded resource text." }, () => ({
  messages: [
    {
      role: "user" as const,
      content: {
        type: "resource" as const,
        resource: {
          uri: "package://raw-inline-resource",
          mimeType: "text/plain",
          text: RAW_PNG_BASE64,
        },
      },
    },
  ],
}))

server.registerPrompt("resource-extra-field", { description: "Return embedded resource content with an unsupported field." }, () => ({
  messages: [
    {
      role: "user" as const,
      content: {
        type: "resource" as const,
        resource: {
          uri: "package://extra-resource",
          mimeType: "text/plain",
          text: "resource with extra field",
          secret: "hidden",
        },
      } as any,
    },
  ],
}))

server.registerPrompt("resource-link", { description: "Return safe resource link metadata." }, () => ({
  messages: [
    {
      role: "user" as const,
      content: {
        type: "resource_link" as const,
        uri: "package://linked-resource",
        name: "linked-resource",
        title: "Linked Resource",
        description: "Safe linked metadata",
        mimeType: "text/plain",
        annotations: {
          audience: ["assistant" as const],
          priority: 0.8,
          lastModified: "2026-07-04T00:00:00.000Z",
        },
        icons: [
          {
            src: "https://example.test/icon.png",
            mimeType: "image/png",
            sizes: ["32x32"],
            theme: "light" as const,
          },
        ],
      },
    },
  ],
}))

server.registerPrompt("resource-link-description-number", { description: "Return non-string resource link description." }, () => ({
  messages: [
    {
      role: "user" as const,
      content: {
        type: "resource_link" as const,
        uri: "package://linked-resource",
        name: "linked-resource",
        description: 42,
      } as any,
    },
  ],
}))

server.registerPrompt(
  "resource-link-annotation-last-modified-number",
  { description: "Return non-string annotation lastModified." },
  () => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "resource_link" as const,
          uri: "package://linked-resource",
          name: "linked-resource",
          annotations: {
            lastModified: 42,
          },
        } as any,
      },
    ],
  }),
)

server.registerPrompt("resource-link-annotation-extra-field", { description: "Return unknown annotation field." }, () => ({
  messages: [
    {
      role: "user" as const,
      content: {
        type: "resource_link" as const,
        uri: "package://linked-resource",
        name: "linked-resource",
        annotations: {
          audience: ["assistant" as const],
          secret: "hidden",
        },
      } as any,
    },
  ],
}))

server.registerPrompt("resource-link-icon-src-number", { description: "Return non-string icon src." }, () => ({
  messages: [
    {
      role: "user" as const,
      content: {
        type: "resource_link" as const,
        uri: "package://linked-resource",
        name: "linked-resource",
        icons: [
          {
            src: 42,
          },
        ],
      } as any,
    },
  ],
}))

server.registerPrompt("resource-link-icon-extra-field", { description: "Return unknown icon field." }, () => ({
  messages: [
    {
      role: "user" as const,
      content: {
        type: "resource_link" as const,
        uri: "package://linked-resource",
        name: "linked-resource",
        icons: [
          {
            src: "https://example.test/icon.png",
            secret: "hidden",
          },
        ],
      } as any,
    },
  ],
}))

server.registerPrompt("resource-link-data-uri", { description: "Return inline base64 inside resource link metadata." }, () => ({
  messages: [
    {
      role: "user" as const,
      content: {
        type: "resource_link" as const,
        uri: "data:image/png;base64,UE5H",
        name: "inline-link",
        title: "Inline Link",
        mimeType: "image/png",
      },
    },
  ],
}))

server.registerPrompt(
  "resource-link-description-data-uri",
  { description: "Return inline base64 inside optional resource link metadata." },
  () => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "resource_link" as const,
          uri: "package://linked-resource",
          name: "inline-description-link",
          description: "data:image/png;base64,UE5H",
          mimeType: "text/plain",
        },
      },
    ],
  }),
)

server.registerPrompt(
  "resource-link-description-raw-data",
  { description: "Return raw base64 inside optional resource link metadata." },
  () => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "resource_link" as const,
          uri: "package://linked-resource",
          name: "raw-description-link",
          description: RAW_PNG_BASE64,
          mimeType: "text/plain",
        },
      },
    ],
  }),
)

server.registerPrompt("meta-text", { description: "Return prompt content with MCP _meta." }, () => ({
  messages: [
    {
      role: "user" as const,
      content: {
        type: "text" as const,
        text: "meta should fail",
        _meta: {
          secret: "hidden",
        },
      },
    },
  ],
}))

server.registerResource(
  "dom",
  "package://dom",
  {
    description: "Return scoped package MCP resource evidence.",
    mimeType: "text/plain",
  },
  (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "text/plain",
        text: `package-mcp-resource:${process.cwd()}`,
      },
    ],
  }),
)

server.registerResource(
  "dom-data-text",
  "package://dom-data-text",
  {
    description: "Return inline base64 inside resource text.",
    mimeType: "text/plain",
  },
  (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "text/plain",
        text: "data:image/png;base64,UE5H",
      },
    ],
  }),
)

server.registerResource(
  "dom-raw-data-text",
  "package://dom-raw-data-text",
  {
    description: "Return raw base64 inside resource text.",
    mimeType: "text/plain",
  },
  (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "text/plain",
        text: RAW_PNG_BASE64,
      },
    ],
  }),
)

server.registerResource(
  "dom-text-number",
  "package://dom-text-number",
  {
    description: "Return non-string resource text.",
    mimeType: "text/plain",
  },
  (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "text/plain",
        text: 42,
      } as any,
    ],
  }),
)

server.registerResource(
  "dom-extra-field",
  "package://dom-extra-field",
  {
    description: "Return resource content with an unsupported field.",
    mimeType: "text/plain",
  },
  (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "text/plain",
        text: "resource with extra field",
        secret: "hidden",
      } as any,
    ],
  }),
)

server.registerResource(
  "dom-binary",
  "package://dom-binary",
  {
    description: "Return binary package MCP resource evidence.",
    mimeType: "application/octet-stream",
  },
  (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/octet-stream",
        blob: "AAEC",
      },
    ],
  }),
)

await server.connect(new StdioServerTransport())
