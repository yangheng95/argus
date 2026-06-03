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

test("provider form discovers OpenAI-compatible models before saving", () => {
  expect(SOURCE).toContain('apiJson("provider/discover-models"');
  expect(SOURCE).toContain('data-testid="provider-discover-models"');
  expect(SOURCE).toContain('provider.form.error.models_required');
  expect(SOURCE).toContain("setFormModels(result.models.join");
});

test("provider form folds derivable fields into advanced settings", () => {
  expect(SOURCE).toContain('class="provider-advanced-fields"');
  expect(SOURCE).toContain('provider.form.advanced_id');
  expect(SOURCE).toContain("providerIdFromApi(formApi())");
  expect(SOURCE).not.toContain("(!editing() && !formId().trim())");
});

test("provider API key editor stays inline despite later field.css defaults", () => {
  expect(STYLES).toContain(".field.provider-api-key-field");
  expect(STYLES).toContain("grid-template-columns: max-content minmax(0, 1fr);");
  expect(STYLES).toContain(".field.provider-api-key-field .field-input");
  expect(STYLES).toContain("width: 100%;");
});

test("provider model discovery controls have stable form styles", () => {
  expect(STYLES).toContain(".provider-model-field-head");
  expect(STYLES).toContain("justify-content: flex-end;");
  expect(STYLES).toContain(".provider-form-notice");
  expect(STYLES).toContain(".provider-advanced-fields");
  expect(STYLES).toContain(".provider-advanced-summary");
  expect(STYLES).toContain(".provider-advanced-fields:not([open]) > .provider-advanced-grid");
  expect(STYLES).toContain("display: none;");
});

test("provider rows keep stable responsive grid areas", () => {
  expect(STYLES).toContain("grid-template-areas:");
  expect(STYLES).toContain('"main summary actions"');
  expect(STYLES).toContain('"key key key"');
  expect(STYLES).toContain('"models models models"');
});
