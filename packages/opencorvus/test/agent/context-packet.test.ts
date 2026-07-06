import { describe, expect, test } from "bun:test"
import {
  agentContextPacketTextByStructuredSchema,
  agentContextStructuredPartBySchema,
  attachmentContextPacket,
  renderAgentContextPacketSection,
  renderAgentContextPackets,
  textContextPacket,
  validateAgentContextPackets,
  type AgentContextPacket,
} from "../../src/agent/context-packet"
import { visualHandoffContextsFromPackets, visualHandoffStructuredPart } from "../../src/context-packets/visual-handoff"

describe("agent context packet protocol", () => {
  test("renders text and multimodal packet parts through one shared context protocol", () => {
    const packet: AgentContextPacket = {
      id: "reference-surface",
      title: "Reference Surface",
      source: "frontend_design",
      scope: "goal_run",
      parts: [
        { type: "text", text: "Use the reference image for the requested desktop surface." },
        {
          type: "media_ref",
          url: "/attachment/project/ref.png",
          mime: "image/png",
          filename: "ref.png",
          scope: { kind: "goal_run", taskID: "tsk_1", goalID: "gol_1", goalRunID: "grn_1" },
        },
        {
          type: "media_ref",
          url: "/attachment/project/narration.mp3",
          mime: "audio/mpeg",
          filename: "narration.mp3",
        },
        {
          type: "structured",
          schema: "opencorvus.test.payload.v1",
          label: "test_payload",
          summary: "items=1",
          data: { secret: "do-not-render", items: [1] },
        },
      ],
    }

    const rendered = renderAgentContextPackets([packet])

    expect(rendered).toContain("# Reference Surface")
    expect(rendered).toContain("context_packet_id: reference-surface")
    expect(rendered).toContain("source: frontend_design")
    expect(rendered).toContain("scope: goal_run")
    expect(rendered).toContain("Use the reference image")
    expect(rendered).toContain("media_ref: type=image; mime=image/png; url=/attachment/project/ref.png")
    expect(rendered).toContain("scope=goal_run (task=tsk_1, goal=gol_1, goal_run=grn_1)")
    expect(rendered).toContain("media_ref: type=audio; mime=audio/mpeg; url=/attachment/project/narration.mp3")
    expect(rendered).toContain("structured_ref: schema=opencorvus.test.payload.v1")
    expect(rendered).toContain("summary=items=1")
    expect(rendered).not.toContain("do-not-render")
    expect(rendered).not.toContain("data:image/")
    expect(rendered).not.toContain("base64")

    expect(
      agentContextStructuredPartBySchema<{ secret: string; items: number[] }>(
        [packet],
        "opencorvus.test.payload.v1",
      ),
    ).toEqual({
      secret: "do-not-render",
      items: [1],
    })
  })

  test("selects semantic context by structured schema instead of source label", () => {
    const schemaPacket = textContextPacket({
      id: "third-party-visual-handoff",
      title: "Third Party Visual Handoff",
      source: "third_party_design",
      scope: "task",
      body: "Reference parity is required for the hero module.",
    })!
    const tagged = {
      ...schemaPacket,
      parts: [...schemaPacket.parts, visualHandoffStructuredPart({ visualReference: true })!],
    }
    const sourceOnly = textContextPacket({
      id: "legacy-frontend-design-source",
      title: "Legacy Frontend Design Source",
      source: "frontend_design",
      scope: "task",
      body: "This source-only packet must not be selected by semantic schema.",
    })!

    const selected = agentContextPacketTextByStructuredSchema(
      [tagged, sourceOnly],
      "opencorvus.context.visual_handoff.v1",
    )

    expect(selected).toContain("Reference parity is required")
    expect(selected).toContain("structured_ref: schema=opencorvus.context.visual_handoff.v1")
    expect(selected).not.toContain("source-only packet")
  })

  test("visual handoff packet carries structured region binding manifests", () => {
    const manifest = {
      version: 1,
      purpose: "visual-region-binding-package",
      generated_at: "2026-07-05T00:00:00.000Z",
      manifest_path: "docs/visual-region-binding.json",
      source_image: "web-clone-source/reference.png",
      source_image_dimensions: { width: 400, height: 300 },
      slicing_strategy: "horizontal_component_bands",
      crop_directory: ".opencorvus/r/t/tsk_context/fd/visual-region-bindings/world",
      bbox_overlay_artifact: ".opencorvus/r/t/tsk_context/fd/visual-region-bindings/world/bbox-overlay.png",
      contact_sheet_artifact: ".opencorvus/r/t/tsk_context/fd/visual-region-bindings/world/contact-sheet.png",
      regions: [
        {
          region_id: "header",
          source_order: 1,
          source_bbox: { x: 0, y: 0, width: 400, height: 120 },
          viewport: "desktop",
          region_scope: "header",
          crop_intent: "full-region",
          target_route: "/",
          implementation_locator: "header.site-header",
          component_files: ["src/components/Header.tsx"],
          reference_region_key: "header@desktop",
          source_reference_artifact: ".opencorvus/r/t/tsk_context/fd/visual-region-bindings/world/header.png",
          source_crop_filename: "header.png",
        },
      ],
    }
    const packet: AgentContextPacket = {
      id: "frontend-design-handoff",
      title: "Frontend Design Handoff",
      source: "frontend_design",
      scope: "task",
      parts: [
        { type: "text", text: "Frontend Design completed component crops." },
        visualHandoffStructuredPart({ visualReference: true, visualRegionBindings: [manifest] })!,
      ],
    }

    const rendered = renderAgentContextPackets([packet])
    const contexts = visualHandoffContextsFromPackets([packet])

    expect(rendered).toContain("visual_region_bindings=1")
    expect(rendered).not.toContain("header@desktop")
    expect(contexts[0]?.visualRegionBindings?.[0]?.regions[0]?.reference_region_key).toBe("header@desktop")
  })

  test("omits empty text packets instead of creating a workflow-specific empty context", () => {
    expect(textContextPacket({ id: "empty", title: "Empty", body: "   " })).toBeUndefined()
    expect(renderAgentContextPackets([])).toBe("")
    expect(renderAgentContextPacketSection([])).toBeUndefined()
  })

  test("renders a shared packet section for task-worker prompts", () => {
    const packet = textContextPacket({
      id: "visual-feedback",
      title: "Visual Feedback",
      source: "visual_qa",
      scope: "task",
      body: "Header spacing is too large.",
    })!

    const rendered = renderAgentContextPacketSection([packet])

    expect(rendered).toContain("# Agent Context Packets")
    expect(rendered).toContain("Media appears as refs only")
    expect(rendered).toContain("# Visual Feedback")
    expect(rendered).toContain("Header spacing is too large.")
  })

  test("converts task attachments into shared link-based media refs", () => {
    const packet = attachmentContextPacket(
      [
        {
          sha: "abc123",
          url: "/attachment/project/reference.png",
          mime: "image/png",
          size: 2048,
          filename: "reference.png",
        },
        {
          url: "attachment:brief.md",
          mime: "text/markdown",
          filename: "brief.md",
        },
      ],
      { note: "Inspect these refs through visible tools." },
    )!

    const rendered = renderAgentContextPacketSection([packet])!

    expect(rendered).toContain("# Task Attachments")
    expect(rendered).toContain("Inspect these refs through visible tools.")
    expect(rendered).toContain("media_ref: type=image; mime=image/png; url=/attachment/project/reference.png")
    expect(rendered).toContain("sha=abc123")
    expect(rendered).toContain("media_ref: type=file; mime=text/markdown; url=attachment:brief.md")
    expect(rendered).not.toContain("intent=")
    expect(rendered).not.toContain("source=user-upload")
    expect(rendered).not.toContain("data:image/")
    expect(rendered).not.toContain("base64")
  })

  test("rejects inline data URL media refs", () => {
    const packet: AgentContextPacket = {
      id: "bad-inline",
      title: "Bad Inline",
      parts: [
        {
          type: "media_ref",
          mime: "image/png",
          url: "data:image/png;base64,UE5H",
        },
      ],
    }

    expect(() => renderAgentContextPackets([packet])).toThrow("must not contain inline data URLs")
    expect(() => renderAgentContextPacketSection([packet])).toThrow("must not contain inline data URLs")
    expect(() => validateAgentContextPackets([packet])).toThrow("must not contain inline data URLs")
  })

  test("rejects data URL media refs without explicit media types", () => {
    for (const url of ["data:;base64,UE5H", "data:,hello"]) {
      const packet: AgentContextPacket = {
        id: `bad-inline-${url.includes("base64") ? "base64" : "text"}`,
        title: "Bad Inline",
        parts: [
          {
            type: "media_ref",
            mime: "image/png",
            url,
          },
        ],
      }

      expect(() => renderAgentContextPackets([packet])).toThrow("must not contain inline data URLs")
    }
  })

  test("rejects inline data URLs inside text and structured packet data", () => {
    const textPacket: AgentContextPacket = {
      id: "bad-text-inline",
      title: "Bad Text Inline",
      parts: [{ type: "text", text: "Screenshot bytes: data:image/png;base64,UE5H" }],
    }
    const structuredPacket: AgentContextPacket = {
      id: "bad-structured-inline",
      title: "Bad Structured Inline",
      parts: [
        {
          type: "structured",
          schema: "opencorvus.test.inline.v1",
          data: {
            media: [{ url: "DATA:image/png;charset=utf-8;base64,UE5H" }],
          },
        },
      ],
    }

    expect(() => renderAgentContextPackets([textPacket])).toThrow("must not contain inline data URLs")
    expect(() => validateAgentContextPackets([structuredPacket])).toThrow("must not contain inline data URLs")
    expect(() =>
      agentContextStructuredPartBySchema([structuredPacket], "opencorvus.test.inline.v1"),
    ).toThrow("must not contain inline data URLs")
  })

  test("rejects inline payloads in renderable packet metadata", () => {
    const metadataPacket: AgentContextPacket = {
      id: "bad-metadata",
      title: "Bad Metadata data:image/png;base64,UE5H",
      source: "visual_qa",
      parts: [{ type: "text", text: "Body is clean." }],
    }
    const mediaMetadataPacket: AgentContextPacket = {
      id: "bad-media-metadata",
      title: "Bad Media Metadata",
      parts: [
        {
          type: "media_ref",
          mime: "image/png",
          url: "/attachment/project/reference.png",
          filename: "reference.png",
          label: "raw " + "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ".repeat(3),
        },
      ],
    }
    const structuredMetadataPacket: AgentContextPacket = {
      id: "bad-structured-metadata",
      title: "Bad Structured Metadata",
      parts: [
        {
          type: "structured",
          schema: "opencorvus.test.metadata.v1",
          summary: "payload=data:application/octet-stream;base64,QUJD",
          data: { ref: "attachment:clean.json" },
        },
      ],
    }
    const prefixedDataUrlPacket: AgentContextPacket = {
      id: "bad-prefixed-data-url",
      title: "prefix=x-data:image/png;base64,UE5H",
      parts: [{ type: "text", text: "Body is clean." }],
    }
    const implicitMediaTypeDataUrlPacket: AgentContextPacket = {
      id: "bad-implicit-media-type-data-url",
      title: "payload=data:;base64,UE5H",
      parts: [{ type: "text", text: "Body is clean." }],
    }

    expect(() => renderAgentContextPackets([metadataPacket])).toThrow("must not contain inline data URLs")
    expect(() => validateAgentContextPackets([mediaMetadataPacket])).toThrow("must not contain inline binary payloads")
    expect(() => renderAgentContextPacketSection([structuredMetadataPacket])).toThrow(
      "must not contain inline data URLs",
    )
    expect(() => renderAgentContextPackets([prefixedDataUrlPacket])).toThrow("must not contain inline data URLs")
    expect(() => renderAgentContextPackets([implicitMediaTypeDataUrlPacket])).toThrow(
      "must not contain inline data URLs",
    )
  })

  test("rejects opaque media_ref urls that are not link or index refs", () => {
    const packet: AgentContextPacket = {
      id: "bad-opaque-media-url",
      title: "Bad Opaque Media URL",
      parts: [
        {
          type: "media_ref",
          mime: "image/png",
          url: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ".repeat(3),
        },
      ],
    }

    expect(() => renderAgentContextPackets([packet])).toThrow("must not contain inline binary payloads")
  })

  test("rejects malformed structured packet parts", () => {
    const packet: AgentContextPacket = {
      id: "bad-structured",
      title: "Bad Structured",
      parts: [{ type: "structured", schema: "  ", data: { value: true } }],
    }

    expect(() => renderAgentContextPackets([packet])).toThrow("structured part schema requires a non-empty string")
    expect(() => validateAgentContextPackets([packet])).toThrow("structured part schema requires a non-empty string")
  })

  test("rejects unsupported packet scopes and part discriminants", () => {
    const invalidScope = {
      id: "bad-scope",
      title: "Bad Scope",
      scope: "workflow",
      parts: [{ type: "text", text: "hello" }],
    } as unknown as AgentContextPacket
    const invalidPart = {
      id: "bad-part",
      title: "Bad Part",
      parts: [{ type: "markdown", text: "hello" }],
    } as unknown as AgentContextPacket

    expect(() => validateAgentContextPackets([invalidScope])).toThrow("scope must be one of task, goal, goal_run, session")
    expect(() => validateAgentContextPackets([invalidPart])).toThrow("unsupported part type")
  })

  test("rejects invalid media_ref scope kinds before rendering", () => {
    const packet = {
      id: "bad-media-scope",
      title: "Bad Media Scope",
      parts: [
        {
          type: "media_ref",
          url: "/attachment/project/reference.png",
          mime: "image/png",
          scope: { kind: "workflow", taskID: "tsk_123" },
        },
      ],
    } as unknown as AgentContextPacket

    expect(() => validateAgentContextPackets([packet])).toThrow("scope.kind must be one of task, goal, goal_run, session")
  })

  test("rejects present null media_ref scope before rendering", () => {
    const packet = {
      id: "null-media-scope",
      title: "Null Media Scope",
      parts: [
        {
          type: "media_ref",
          url: "/attachment/project/reference.png",
          mime: "image/png",
          scope: null,
        },
      ],
    } as unknown as AgentContextPacket

    expect(() => validateAgentContextPackets([packet])).toThrow("scope must be an object")
  })

  test("rejects unsupported or non-string media_ref scope fields", () => {
    const extraScopeField = {
      id: "bad-media-scope-extra",
      title: "Bad Media Scope Extra",
      parts: [
        {
          type: "media_ref",
          url: "/attachment/project/reference.png",
          mime: "image/png",
          scope: { kind: "task", taskID: "tsk_123", workflowID: "wf_123" },
        },
      ],
    } as unknown as AgentContextPacket
    const nonStringScopeField = {
      id: "bad-media-scope-value",
      title: "Bad Media Scope Value",
      parts: [
        {
          type: "media_ref",
          url: "/attachment/project/reference.png",
          mime: "image/png",
          scope: { kind: "task", taskID: 123 },
        },
      ],
    } as unknown as AgentContextPacket

    expect(() => validateAgentContextPackets([extraScopeField])).toThrow("unsupported field")
    expect(() => validateAgentContextPackets([nonStringScopeField])).toThrow("scope.taskID must be a string")
  })

  test("schema-specific text rendering rejects unknown parts in selected packets", () => {
    const packet = {
      id: "mixed-invalid",
      title: "Mixed Invalid",
      parts: [
        { type: "structured", schema: "opencorvus.test.schema.v1", data: { ok: true } },
        { type: "unknown", schema: "opencorvus.test.unknown.v1", data: { leaked: true } },
      ],
    } as unknown as AgentContextPacket

    expect(() => agentContextPacketTextByStructuredSchema([packet], "opencorvus.test.schema.v1")).toThrow(
      "unsupported part type",
    )
  })
})
