import { expect, test } from "bun:test";

const src = (path: string) => Bun.file(new URL(`../src/${path}`, import.meta.url)).text();

function blocksFor(css: string, selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...css.matchAll(new RegExp(`${escaped}[^{}]*\\{[^{}]*\\}`, "g"))].map((match) => match[0]);
}

test("role-based top-level cards do not use stage left rails", async () => {
  const css = await src("styles/card.css");

  expect(css).not.toContain("--card-stage");
  for (const selector of [
    '.card[data-depth="0"][data-kind="agent"][data-stage]',
    '.card[data-depth="0"][data-kind="goal"]',
    '.card[data-depth="0"][data-kind="step"][data-stage]',
  ]) {
    expect(blocksFor(css, selector).some((block) => /border-left:\s*0/.test(block))).toBe(true);
  }
  expect(css).not.toContain('border-left: 3px solid var(--card-role, var(--card-border-strong))');
  expect(css).not.toContain('border-left: 3px solid var(--card-role, var(--role-execution))');
});

test("message cards use role wash instead of user/system left rails", async () => {
  const css = await src("styles/card.css");

  for (const selector of [
    '.card[data-kind="message"][data-role="user"]',
    '.card[data-kind="message"][data-role="system"]',
  ]) {
    const blocks = blocksFor(css, selector);
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.every((block) => !/border-left:\s*(?:2|3)px/.test(block))).toBe(true);
    expect(blocks.some((block) => /border-left:\s*0/.test(block))).toBe(true);
  }
});

test("card badges avoid inset noise", async () => {
  const css = await src("styles/card.css");
  const badgeCss = blocksFor(css, ".card__badge").join("\n");

  expect(badgeCss).not.toContain("inset");
});

test("reasoning blocks are quiet metadata, not hard uppercase panels", async () => {
  const css = await src("styles.css");
  const reasoning = blocksFor(css, ".msg-reasoning").join("\n");
  const label = blocksFor(css, ".reasoning-label").join("\n");

  expect(reasoning).toContain("var(--ui-font-meta)");
  expect(reasoning).toContain("var(--status-info)");
  expect(reasoning).not.toMatch(/border:\s*1px/);
  expect(label).toContain("text-transform: none");
  expect(label).not.toContain("text-transform: uppercase");
});
