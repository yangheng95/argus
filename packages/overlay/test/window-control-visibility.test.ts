import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const OVERLAY_ROOT = path.resolve(import.meta.dir, "..");

function read(relativePath: string): string {
  return readFileSync(path.join(OVERLAY_ROOT, relativePath), "utf8");
}

function soloRuleBody(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const head = new RegExp(`(^|\\n)${escaped}\\s*\\{`, "m").exec(source);
  if (!head) throw new Error(`selector not found: ${selector}`);
  const open = head.index + head[0].length - 1;
  const close = source.indexOf("}", open);
  if (close < 0) throw new Error(`malformed block for ${selector}`);
  return source.slice(open + 1, close);
}

describe("window controls use native-style quiet chrome", () => {
  test("primitive keeps window controls quiet at rest and explicit on hover", () => {
    const css = read("src/styles/primitives/button.css");
    expect(css).toContain('[data-chrome="window-control"]');
    expect(css).toContain("--oc-button-color: var(--text-soft);");
    expect(css).toContain("--oc-button-bg: transparent;");
    expect(css).toContain("--oc-button-shadow: none;");
    expect(css).toContain('data-chrome="window-control"][data-tone="danger"]');
    expect(css).not.toContain("color-mix(in srgb, var(--bad) 74%, var(--text-strong))");
    expect(css).not.toContain("color-mix(in srgb, var(--border-strong) 58%, transparent)");
    expect(css).toContain('--oc-button-color: var(--surface);');
    expect(css).toContain('--oc-button-bg: color-mix(in srgb, var(--bad) 88%, var(--surface));');
  });

  test("titlebar surface no longer owns close button contrast directly", () => {
    const css = read("src/styles/surfaces/titlebar.css");
    const body = soloRuleBody(css, ".titlebar-window-controls .oc-button");
    expect(body).not.toContain("--oc-button-bg:");
    expect(css).not.toContain('.titlebar-window-controls .oc-button[data-tone="danger"]');
  });

  test("window control icon names map to window semantics, not fullscreen arrows", () => {
    const icon = read("src/components/Icon.tsx");
    expect(icon).toContain("minimize: { component: Minus");
    expect(icon).toContain("maximize: { component: Square");
    expect(icon).toContain("restore: { component: Copy");
    expect(icon).not.toContain("minimize: { component: Minimize");
    expect(icon).not.toContain("maximize: { component: Maximize");
    expect(icon).not.toContain("restore: { component: Maximize2");
  });
});
