import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const GENERAL_PANEL_SOURCE = readFileSync(
  join(import.meta.dir, "../src/components/settings/GeneralPanel.tsx"),
  "utf8",
);
const EN = JSON.parse(readFileSync(join(import.meta.dir, "../src/i18n/en-US.json"), "utf8"));
const ZH = JSON.parse(readFileSync(join(import.meta.dir, "../src/i18n/zh-CN.json"), "utf8"));

// Pins the live-update contract for the compaction.threshold slider.
// Regression target: if anyone removes the patchConfig wiring or swaps it
// for a debounced save / "Apply" button, the threshold stops being
// real-time and reproduces the prior "edit config file + restart" workflow.

test("GeneralPanel exposes compaction threshold via real-time patchConfig", () => {
  expect(GENERAL_PANEL_SOURCE).toContain('settings.compaction_threshold_label');
  expect(GENERAL_PANEL_SOURCE).toContain('settings.compaction_threshold_hint');
  expect(GENERAL_PANEL_SOURCE).toContain('type="range"');
  expect(GENERAL_PANEL_SOURCE).toContain('appStore.config as any)?.compaction?.threshold');
  expect(GENERAL_PANEL_SOURCE).toContain('patchConfig({ compaction: { threshold:');
});

test("compaction threshold i18n keys exist in both locales", () => {
  expect(typeof EN["settings.compaction_threshold_label"]).toBe("string");
  expect(typeof EN["settings.compaction_threshold_hint"]).toBe("string");
  expect(typeof ZH["settings.compaction_threshold_label"]).toBe("string");
  expect(typeof ZH["settings.compaction_threshold_hint"]).toBe("string");
  expect(EN["settings.compaction_threshold_label"]).not.toBe("");
  expect(ZH["settings.compaction_threshold_label"]).not.toBe("");
});
