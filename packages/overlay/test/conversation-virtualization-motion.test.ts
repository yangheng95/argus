import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..", "..");

describe("conversation virtualization motion", () => {
  test("keeps virtual segments stable across measurement updates", () => {
    const source = readFileSync(join(repoRoot, "packages/overlay/src/components/Conversation.tsx"), "utf8");

    expect(source).toContain("import { For, Index, Show");
    expect(source).toContain("<Index each={segments()}>");
    expect(source).toContain("</Index>");
  });

  test("does not replay bubble enter animations for virtualized cards", () => {
    const css = readFileSync(join(repoRoot, "packages/overlay/src/styles/surfaces/conversation.css"), "utf8");

    expect(css).toContain(".conversation-virtual-item .chat-bubble");
    expect(css).toContain(".conversation-virtual-item .chat-avatar");
    expect(css).toContain(".conversation-virtual-item .chat-bubble__body-inner");
    expect(css).toContain("animation: none;");
  });
});
