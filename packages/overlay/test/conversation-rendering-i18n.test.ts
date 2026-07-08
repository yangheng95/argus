import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const OVERLAY_ROOT = join(import.meta.dir, "..")

function read(relativePath: string): string {
  return readFileSync(join(OVERLAY_ROOT, relativePath), "utf8")
}

describe("conversation rendering i18n", () => {
  test("conversation tool labels and accessible names come from locale keys", () => {
    const cardParts = read("src/components/CardParts.tsx")
    const inlineToolPart = read("src/components/InlineToolPart.tsx")
    const agentRail = read("src/components/ConversationAgentRail.tsx")
    const toolCardNode = read("src/utils/tool-card-node.ts")
    const cardHeader = read("src/components/CardHeader.tsx")
    const en = read("src/i18n/en-US.json")
    const zh = read("src/i18n/zh-CN.json")

    expect(cardParts).toContain('t("card.subtask")')
    expect(cardParts).not.toContain('<span class="tool-name">Subtask</span>')
    expect(cardParts).toContain("CardParts unsupported part type")
    expect(cardParts).toContain("fallback={unsupportedPartFallback(part)}")
    expect(cardParts).not.toContain("fallback={null}")
    expect(cardParts).toContain('"part-error"')
    expect(cardParts).toContain('t("chat.part_error_title")')

    expect(inlineToolPart).toContain('t("tool.loaded_instructions")')
    expect(inlineToolPart).toContain('t("tool.browser_observation_alt_with_label"')
    expect(inlineToolPart).toContain('tc("files.changed", props.items.length)')
    expect(inlineToolPart).not.toContain(">Loaded instructions<")
    expect(inlineToolPart).not.toContain('alt="Browser observation"')
    expect(inlineToolPart).not.toContain('props.items.length === 1 ? "file" : "files"')

    expect(agentRail).toContain('aria-label={t("agent_rail.workflow_label")}')
    expect(agentRail).toContain("AGENT_RAIL_STATUS_LABELS")
    expect(agentRail).toContain('t("agent_rail.status.running")')
    expect(agentRail).toContain('t("agent_rail.detail.summary"')
    expect(agentRail).not.toContain('aria-label="Agent workflow"')

    expect(toolCardNode).toContain('"tool.card.todos"')
    expect(toolCardNode).toContain('"tool.card.plan"')
    expect(toolCardNode).not.toContain('todowrite: "Todos"')
    expect(toolCardNode).not.toContain('updateplan: "Plan"')
    expect(cardHeader).toContain('if (title === "tool.card.todos") return t("tool.card.todos")')
    expect(cardHeader).toContain('if (title === "tool.card.plan") return t("tool.card.plan")')

    for (const locale of [en, zh]) {
      expect(locale).toContain('"card.subtask"')
      expect(locale).toContain('"tool.loaded_instructions"')
      expect(locale).toContain('"tool.browser_observation_alt"')
      expect(locale).toContain('"tool.browser_observation_alt_with_label"')
      expect(locale).toContain('"agent_rail.workflow_label"')
      expect(locale).toContain('"agent_rail.status.running"')
      expect(locale).toContain('"agent_rail.detail.summary"')
      expect(locale).toContain('"tool.card.todos"')
      expect(locale).toContain('"tool.card.plan"')
      expect(locale).toContain('"chat.part_error_title"')
      expect(locale).toContain('"chat.part_error_message"')
      expect(locale).toContain('"chat.part_error_unknown"')
    }
  })

  test("promoted todo and plan tool cards expose translatable title keys", async () => {
    const { toolToCardNode } = await import("../src/utils/tool-card-node")

    expect(
      toolToCardNode({
        id: "todo",
        type: "tool",
        tool: "todowrite",
        orderKey: "v1:0001776000000001:0000000000000031:0000000000000000:part:todo",
        state: { time: { start: 1_776_000_000_001 } },
      }).title,
    ).toBe("tool.card.todos")
    expect(
      toolToCardNode({
        id: "plan",
        type: "tool",
        tool: "updateplan",
        orderKey: "v1:0001776000000002:0000000000000031:0000000000000000:part:plan",
        state: { time: { start: 1_776_000_000_002 } },
      }).title,
    ).toBe("tool.card.plan")
  })
})
