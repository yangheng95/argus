import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SURFACE_HEADER_SOURCE = join(import.meta.dir, "../src/components/ui/SurfaceHeader.tsx");
const HEADER_CSS = join(import.meta.dir, "../src/styles/surfaces/header.css");
const LEGACY_CSS = join(import.meta.dir, "../src/styles.css");

function blocksForSelectors(css: string, classNames: string[]): Array<{ selector: string; body: string }> {
  const blocks: Array<{ selector: string; body: string }> = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of css.matchAll(re)) {
    const selector = match[1] ?? "";
    const body = match[2] ?? "";
    if (classNames.some((className) => new RegExp(`\\.${className}(?![-\\w])`).test(selector))) {
      blocks.push({ selector, body });
    }
  }
  return blocks;
}

test("SurfaceHeader owns the canonical header structure", () => {
  const source = readFileSync(SURFACE_HEADER_SOURCE, "utf8");

  expect(source).toContain('export const SURFACE_HEADER_VARIANTS = ["panel", "settings-group"] as const');
  expect(source).toContain('Omit<JSX.HTMLAttributes<HTMLElement>, "class" | "classList" | "title">');
  expect(source).toContain('class="oc-surface-header"');
  expect(source).toContain('data-surface={local.variant}');
  expect(source).toContain('class="oc-surface-header__title"');
  expect(source).toContain('class="oc-surface-header__actions"');
  expect(source).not.toMatch(/\b(?:ext-group-head|config-panel-group-title|sidebar-header|chat-header|sections-header)\b/);
});

test("SurfaceHeader variants have surface CSS hooks", () => {
  const css = readFileSync(HEADER_CSS, "utf8");

  expect(css).toContain('.oc-surface-header[data-surface="settings-group"]');
  expect(css).toContain(".sections-tabs.oc-surface-header__actions");
  expect(css).toContain("var(--oc-header-actions-padding)");
  expect(css).toContain("var(--oc-header-title-line-height)");
});

test("legacy God CSS no longer owns base surface header chrome", () => {
  const css = readFileSync(LEGACY_CSS, "utf8");

  expect(css).not.toMatch(/(^|\n)\.(?:sidebar-header|chat-header|sections-header)\s*\{/);
});

test("surface header actions own action spacing outside theme resets", () => {
  const css = readFileSync(LEGACY_CSS, "utf8");

  expect(css).not.toMatch(/(^|\n)\.(?:sidebar-header-actions|chat-header-meta)\s*\{[^}]*\bgap\s*:/);
  expect(css).not.toMatch(/body[^{]*\.sidebar-header-actions(?![-\w])[^{}]*\{[^}]*\bgap\s*:/);
});

test("surface header titles own title typography outside theme resets", () => {
  const css = readFileSync(LEGACY_CSS, "utf8");
  const titleBlocks = blocksForSelectors(css, ["sidebar-title", "chat-title", "sections-title"]);
  const typography = /\b(?:font(?:-size|-weight)?|line-height|color|letter-spacing|text-transform)\s*:/;

  for (const block of titleBlocks) {
    expect(block.body).not.toMatch(typography);
  }
});
