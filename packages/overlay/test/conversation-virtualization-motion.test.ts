import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..", "..");

describe("conversation virtualization motion", () => {
  test("uses virtua instead of the old spacer-based virtual window", () => {
    const source = readFileSync(join(repoRoot, "packages/overlay/src/components/Conversation.tsx"), "utf8");

    expect(source).toContain('from "virtua/solid"');
    expect(source).toContain("<Virtualizer");
    expect(source).toContain("scrollRef={props.container}");
    expect(source).not.toContain("conversation-virtual-spacer");
    expect(source).not.toContain("bottomPadding");
  });

  test("does not replay bubble enter animations for virtualized cards", () => {
    const css = readFileSync(join(repoRoot, "packages/overlay/src/styles/surfaces/conversation.css"), "utf8");

    expect(css).toContain(".conversation-virtual-item .chat-bubble");
    expect(css).toContain(".conversation-virtual-item .chat-avatar");
    expect(css).toContain(".conversation-virtual-item .chat-bubble__body-inner");
    expect(css).toContain("animation: none;");
  });
});
