import { describe, expect, test } from "bun:test";
import path from "node:path";

const overlayRoot = path.resolve(import.meta.dir, "..");

async function readSource(rel: string): Promise<string> {
  return await Bun.file(path.join(overlayRoot, rel)).text();
}

function firstRuleBlock(styles: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";
}

describe("chat composer shell", () => {
  const legacyMetaClass = `chat-compose-${"meta"}`;
  const legacyActionsClass = `chat-${"icon"}-col`;
  const legacyTipKey = `chat.${"tip"}`;
  const caretProperty = `caret-${"color"}`;

  test("uses the single-row composer structure", async () => {
    const component = await readSource("src/components/ChatComposer.tsx");
    const rowStart = component.indexOf('<div class="chat-compose-row">');
    const rowEnd = component.indexOf('{/* Send / Stop button */}', rowStart);
    const rowBody = component.slice(rowStart, rowEnd);

    expect(rowStart).toBeGreaterThan(-1);
    expect(rowBody).toContain("<ExecutorSelector />");
    expect(rowBody.indexOf("<ExecutorSelector />")).toBeLessThan(rowBody.indexOf('class="chat-textarea-wrap"'));
    expect(rowBody).toContain('class="chat-actions-row"');
  });

  test("removes the legacy meta row and visual shortcut tip", async () => {
    const source = [
      await readSource("src/components/ChatComposer.tsx"),
      await readSource("src/components/ExecutorSelector.tsx"),
      await readSource("src/main.tsx"),
      await readSource("src/styles.css"),
      await readSource("src/i18n/en-US.json"),
      await readSource("src/i18n/zh-CN.json"),
    ].join("\n");

    expect(source).not.toContain(legacyMetaClass);
    expect(source).not.toContain(legacyActionsClass);
    expect(source).not.toContain(legacyTipKey);
  });

  test("actions are horizontal and use the shared icon button size", async () => {
    const styles = await readSource("src/styles.css");
    const root = firstRuleBlock(styles, ":root");
    const actions = firstRuleBlock(styles, ".chat-actions-row");
    const toolbar = firstRuleBlock(styles, ".chat-toolbar-btn");

    expect(root).toContain("--ui-icon-btn-size:");
    expect(actions).toContain("display: flex");
    expect(actions).toContain("flex-direction: row");
    expect(toolbar).toContain("var(--ui-icon-btn-size)");
  });

  test("composer owns the only border while textarea stays below 80px collapsed", async () => {
    const styles = await readSource("src/styles.css");
    const input = firstRuleBlock(styles, ".chat-input");
    const textarea = firstRuleBlock(styles, ".chat-textarea");
    const collapsedHeightRules = [...styles.matchAll(/(?:^|\n)(?:\.chat-textarea-wrap,\s*\n\.chat-textarea|\.chat-textarea)\s*\{[^{}]*?min-height:\s*calc\((\d+)px/g)]
      .map((match) => Number(match[1]));

    expect(input).toContain("border: 1px solid");
    expect(input).toContain("border-radius: var(--panel-radius)");
    expect(input).toContain("var(--surface)");
    expect(input).toContain("box-shadow: var(--shadow-float)");
    expect(textarea).toContain("border: 0");
    expect(styles).not.toContain(caretProperty);
    expect(collapsedHeightRules.length).toBeGreaterThan(0);
    expect(collapsedHeightRules.every((height) => height < 80)).toBe(true);
  });
});
