import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const BUTTON_SOURCE = join(import.meta.dir, "../src/components/ui/Button.tsx");

test("Button primitive exposes the canonical data-attribute contract", () => {
  const source = readFileSync(BUTTON_SOURCE, "utf8");

  expect(source).toContain('export type ButtonVariant = "solid" | "outline" | "ghost"');
  expect(source).toContain('export type ButtonSize = "sm" | "md" | "icon"');
  expect(source).toContain('export type ButtonTone = "neutral" | "accent" | "danger"');
  expect(source).toContain('variant: ButtonVariant');
  expect(source).toContain('size: ButtonSize');
  expect(source).toContain('tone: ButtonTone');
  expect(source).toContain('"oc-button"');
  expect(source).toContain("data-variant={local.variant}");
  expect(source).toContain("data-size={local.size}");
  expect(source).toContain("data-tone={local.tone}");
});
