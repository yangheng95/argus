import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "../src/styles/surfaces/conversation.css"), "utf8");

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  if (!match) throw new Error(`missing selector ${selector}`);
  return match[1] || "";
}

test("agent report dialog uses one scroll owner for dialog body", () => {
  const body = ruleBody(".agent-report-dialog__content,\n.agent-report-dialog__empty");
  expect(body).toContain("min-height: 0");
  expect(body).toContain("overflow: auto");

  const panel = ruleBody(".agent-report-dialog__panel");
  expect(panel).toContain("display: flex");
  expect(panel).toContain("flex-direction: column");
  expect(panel).toContain("overflow: hidden");
});

test("old workflow report section and pre scroll rules stay deleted", () => {
  expect(css).not.toContain(".agent-workflow-report-section:last-child");
  expect(css).not.toContain(".agent-workflow-report-section pre");
  expect(css).not.toContain("max-height: calc(340px * var(--ui-scale))");
});
