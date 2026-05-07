import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TABS_SOURCE = join(import.meta.dir, "../src/components/ui/Tabs.tsx");
const TABS_CSS = join(import.meta.dir, "../src/styles/primitives/tabs.css");
const LEGACY_STYLES = join(import.meta.dir, "../src/styles.css");

function sourceArray(source: string, name: string): string[] {
  const match = source.match(new RegExp(`export const ${name} = \\[([^\\]]+)\\] as const`));
  expect(match).not.toBeNull();
  return match![1]!
    .split(",")
    .map((part) => part.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

function cssDataValues(css: string, attr: "size" | "tone"): string[] {
  return Array.from(
    new Set(
      Array.from(css.matchAll(new RegExp(`\\.oc-tabs?\\[data-${attr}="([^"]+)"\\]`, "g"))).map(
        (match) => match[1]!,
      ),
    ),
  ).sort();
}

test("Tabs primitive exposes the canonical data-attribute contract", () => {
  const source = readFileSync(TABS_SOURCE, "utf8");

  expect(source).toContain('export const TABS_SIZES = ["sm", "md"] as const');
  expect(source).toContain('export const TABS_TONES = ["neutral"] as const');
  expect(source).toContain('Omit<JSX.HTMLAttributes<HTMLDivElement>, "class" | "classList" | "role">');
  expect(source).toContain('Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "class" | "classList" | "role">');
  expect(source).toContain('class="oc-tabs"');
  expect(source).toContain('class="oc-tab"');
  expect(source).toContain('role="tablist"');
  expect(source).toContain('role="tab"');
  expect(source).toContain('data-active={local.active ? "true" : "false"}');
  expect(source).not.toMatch(/\b(?:right-panel-tab|btn|workspace-toggle)\b/);
});

test("Tabs primitive TypeScript API and CSS data variants stay in lockstep", () => {
  const source = readFileSync(TABS_SOURCE, "utf8");
  const css = readFileSync(TABS_CSS, "utf8");

  expect(cssDataValues(css, "size")).toEqual(sourceArray(source, "TABS_SIZES").sort());
  expect(cssDataValues(css, "tone")).toEqual(sourceArray(source, "TABS_TONES").sort());
});

test("Tabs primitive is the only right-panel tab chrome owner", () => {
  const legacy = readFileSync(LEGACY_STYLES, "utf8");

  expect(legacy).not.toMatch(/\.right-panel-tab(?:list)?\b/);
});
