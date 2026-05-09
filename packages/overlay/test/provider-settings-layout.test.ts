import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(join(import.meta.dir, "../src/components/settings/ProvidersPanel.tsx"), "utf8");
const STYLES = readFileSync(join(import.meta.dir, "../src/styles/surfaces/settings.css"), "utf8");

test("ProvidersPanel uses a dedicated command area and provider row summary", () => {
  expect(SOURCE).toContain('class="provider-command"');
  expect(SOURCE).toContain('class="provider-stat-strip"');
  expect(SOURCE).toContain('class="provider-row-summary"');
  expect(SOURCE).toContain('class="provider-count-pill"');
});

test("provider API key editor stays inline despite later field.css defaults", () => {
  expect(STYLES).toContain(".field.provider-api-key-field");
  expect(STYLES).toContain("grid-template-columns: max-content minmax(0, 1fr);");
  expect(STYLES).toContain(".field.provider-api-key-field .field-input");
  expect(STYLES).toContain("width: 100%;");
});

test("provider rows keep stable responsive grid areas", () => {
  expect(STYLES).toContain("grid-template-areas:");
  expect(STYLES).toContain('"main summary actions"');
  expect(STYLES).toContain('"key key key"');
  expect(STYLES).toContain('"models models models"');
});
