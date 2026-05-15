import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TEXT_PART = readFileSync(join(import.meta.dir, "..", "src", "components", "TextPart.tsx"), "utf8");
const REASONING_PART = readFileSync(join(import.meta.dir, "..", "src", "components", "ReasoningPart.tsx"), "utf8");
const CARD_PARTS = readFileSync(join(import.meta.dir, "..", "src", "components", "CardParts.tsx"), "utf8");
const CARD = readFileSync(join(import.meta.dir, "..", "src", "components", "Card.tsx"), "utf8");
const CARD_HEADER = readFileSync(join(import.meta.dir, "..", "src", "components", "CardHeader.tsx"), "utf8");
const CHAT_BUBBLE = readFileSync(join(import.meta.dir, "..", "src", "components", "ChatBubble.tsx"), "utf8");
const MARKDOWN_CSS = readFileSync(join(import.meta.dir, "..", "src", "styles", "surfaces", "markdown.css"), "utf8");

test("TextPart does not gate streaming text visibility on requestAnimationFrame", () => {
  expect(TEXT_PART).not.toContain("requestAnimationFrame");
  expect(TEXT_PART).not.toContain("cancelAnimationFrame");
  expect(TEXT_PART).toContain('<div class="md-active-text">{activeText()}</div>');
});

test("ReasoningPart does not synchronously markdown-render streaming text", () => {
  expect(REASONING_PART).toContain('props.streaming ? "" : renderMarkdown(text())');
  expect(REASONING_PART).toContain('<div class="reasoning-text reasoning-text--streaming">{text()}</div>');
  expect(REASONING_PART).not.toContain('innerHTML={renderMarkdown(text())}');
});

test("CardParts passes explicit streaming ownership into text renderers", () => {
  expect(CARD_PARTS).toContain("streaming?: boolean");
  expect(CARD_PARTS).toContain('<TextPart text={part.text || ""} streaming={props.streaming} />');
  expect(CARD_PARTS).toContain('<ReasoningPart part={part} streaming={props.streaming} />');
});

test("raw active streaming text preserves line breaks", () => {
  expect(MARKDOWN_CSS).toContain(".md-active-text,\n.reasoning-text--streaming");
  expect(MARKDOWN_CSS).toContain("white-space: pre-wrap");
});

test("collapsed running cards do not recursively scan streamed body text", () => {
  expect(CARD).toContain('if (props.node.status === "running") return null;');
  expect(CARD_HEADER).toContain('props.node.status !== "running"');
  expect(CHAT_BUBBLE).toContain('if (props.node.status === "running") return null');
  expect(CHAT_BUBBLE).toContain('!expanded() && props.node.status !== "running"');
});
