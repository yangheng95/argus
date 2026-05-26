// Regression guard for the hover-only task-row action buttons.
//
// The task-list rows carry up to three icon buttons (delete, cancel/stop,
// start-now). They used to render at `--ui-opacity-subtle` by default and
// promote to full opacity on hover/focus/active — visually busy and easy to
// mis-click while scanning the list. The contract this test pins is:
//
//   * Default opacity is `0` and pointer-events is `none` so the buttons sit
//     completely out of the way (and a stray mouseover near a fading icon
//     can't fire a delete).
//   * The reveal selector group — `:hover`, `:focus-within`, and
//     `[data-active="true"]` — promotes opacity to full and re-enables
//     pointer events for all three icon kinds.
//
// If a future cleanup reverts to "always visible" defaults this test will
// fail before the diff lands.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const SIDEBAR_CSS = path.resolve(
  import.meta.dir,
  "..",
  "src",
  "styles",
  "surfaces",
  "sidebar.css",
);

function readText(p: string): string {
  return readFileSync(p, "utf8");
}

function stripCssComments(input: string): string {
  return input.replace(/\/\*[\s\S]*?\*\//g, "");
}

function extractRule(css: string, selector: string): string | null {
  const stripped = stripCssComments(css);
  for (const chunk of stripped.split("}")) {
    const openIdx = chunk.indexOf("{");
    if (openIdx < 0) continue;
    const head = chunk.slice(0, openIdx).trim();
    if (!head) continue;
    const segments = head.split(",").map((s) => s.trim());
    if (segments.includes(selector)) return chunk.slice(openIdx + 1).trim();
  }
  return null;
}

describe("task-row action buttons — hover-only contract", () => {
  const css = readText(SIDEBAR_CSS);

  test("default state hides all three action button kinds", () => {
    const body = extractRule(
      css,
      '.task-row-actions .oc-button[data-ui="task-row-delete"]',
    );
    expect(body).not.toBeNull();
    expect(body!).toContain("opacity: 0");
    expect(body!).toContain("pointer-events: none");
  });

  test("default selector groups delete, cancel, and start-now", () => {
    const stripped = stripCssComments(css);
    const ruleHead = stripped.match(
      /\.task-row-actions \.oc-button\[data-ui="task-row-delete"\],\s*\.task-row-actions \.oc-button\[data-ui="task-row-cancel"\],\s*\.task-row-actions \.oc-button\[data-ui="task-row-start-now"\]\s*\{/,
    );
    expect(ruleHead).not.toBeNull();
  });

  test("hover/focus/active reveal restores opacity and pointer events", () => {
    const body = extractRule(
      css,
      '.task-row-mini:hover .oc-button[data-ui="task-row-delete"]',
    );
    expect(body).not.toBeNull();
    expect(body!).toContain("opacity: var(--ui-opacity-full)");
    expect(body!).toContain("pointer-events: auto");
  });

  test("reveal selector group covers all three button kinds across all three states", () => {
    const stripped = stripCssComments(css);
    const expected = [
      '.task-row-mini:hover .oc-button[data-ui="task-row-delete"]',
      '.task-row-mini:focus-within .oc-button[data-ui="task-row-delete"]',
      '.task-row-mini[data-active="true"] .oc-button[data-ui="task-row-delete"]',
      '.task-row-mini:hover .oc-button[data-ui="task-row-cancel"]',
      '.task-row-mini:focus-within .oc-button[data-ui="task-row-cancel"]',
      '.task-row-mini[data-active="true"] .oc-button[data-ui="task-row-cancel"]',
      '.task-row-mini:hover .oc-button[data-ui="task-row-start-now"]',
      '.task-row-mini:focus-within .oc-button[data-ui="task-row-start-now"]',
      '.task-row-mini[data-active="true"] .oc-button[data-ui="task-row-start-now"]',
    ];
    for (const selector of expected) {
      expect(stripped).toContain(selector);
    }
  });
});
