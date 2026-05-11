import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "../src/styles/surfaces/agent-workflow.css"), "utf8");

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  if (!match) throw new Error(`missing selector ${selector}`);
  return match[1] || "";
}

test("agent workflow report uses one scroll owner for popover body", () => {
  const body = ruleBody(".agent-workflow-report-body");
  expect(body).toContain("flex: 1 1 auto");
  expect(body).toContain("min-height: 0");
  expect(body).toContain("overflow-y: auto");

  const head = ruleBody(".agent-workflow-report-head");
  expect(head).toContain("flex: 0 0 auto");
});

test("old last-child and pre scroll fallback rules stay deleted", () => {
  const lastChild = ruleBody(".agent-workflow-report-section:last-child");
  expect(lastChild).not.toContain("overflow: auto");
  expect(lastChild).not.toContain("min-height: 0");

  const pre = ruleBody(".agent-workflow-report-section pre");
  expect(pre).not.toContain("max-height: calc(340px * var(--ui-scale))");
  expect(pre).not.toContain("overflow: auto");
});
