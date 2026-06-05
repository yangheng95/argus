// Regression guard for the hover-only task-row action buttons.
//
// The task-list rows carry up to five icon buttons (delete, cancel/stop,
// rename, download, start-now). They used to render at `--ui-opacity-subtle`
// by default and promote to full opacity on hover/focus, which was visually
// busy and easy to mis-click while scanning the list. The contract this test
// pins is:
//
//   * Default opacity is `0` and pointer-events is `none` so the buttons sit
//     completely out of the way (and a stray mouseover near a fading icon
//     cannot fire a delete).
//   * The action rail is absolutely positioned so hidden actions do not
//     participate in the row's resting grid/flex sizing.
//   * Rows with actions switch their right grid track to the action slot only
//     while hovered/focused, so visible buttons do not cover the title.
//   * The reveal selector group -- `:hover` and `:focus-within` -- promotes
//     opacity to full and re-enables pointer events for every icon kind.
//   * The task-row rail overrides generic icon-action chrome so all icons
//     share the same button shell and SVG size.
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

describe("task-row action buttons hover-only contract", () => {
  const css = readText(SIDEBAR_CSS);

  test("default state hides all five action button kinds", () => {
    const body = extractRule(
      css,
      '.task-row-actions .oc-button[data-chrome="icon-action"][data-ui="task-row-delete"]',
    );
    expect(body).not.toBeNull();
    expect(body!).toContain("opacity: 0");
    expect(body!).toContain("pointer-events: none");
  });

  test("default selector groups delete, cancel, rename, download, and start-now", () => {
    const stripped = stripCssComments(css);
    const ruleHead = stripped.match(
      /\.task-row-actions \.oc-button\[data-chrome="icon-action"\]\[data-ui="task-row-delete"\],\s*\.task-row-actions \.oc-button\[data-chrome="icon-action"\]\[data-ui="task-row-cancel"\],\s*\.task-row-actions \.oc-button\[data-chrome="icon-action"\]\[data-ui="task-row-rename"\],\s*\.task-row-actions \.oc-button\[data-chrome="icon-action"\]\[data-ui="task-row-download"\],\s*\.task-row-actions \.oc-button\[data-chrome="icon-action"\]\[data-ui="task-row-start-now"\]\s*\{/,
    );
    expect(ruleHead).not.toBeNull();
  });

  test("task-row rail removes generic icon-action shell and normalizes SVG size", () => {
    const body = extractRule(
      css,
      '.task-row-actions .oc-button[data-chrome="icon-action"][data-ui="task-row-delete"]',
    );
    expect(body).not.toBeNull();
    expect(body!).toContain("--oc-button-shadow: none");
    expect(body!).toContain("border-radius: var(--oc-radius-sm)");

    const iconBody = extractRule(
      css,
      '.task-row-actions .oc-button[data-ui="task-row-delete"] svg',
    );
    expect(iconBody).not.toBeNull();
    expect(iconBody!).toContain("width: calc(12px * var(--ui-scale))");
    expect(iconBody!).toContain("height: calc(12px * var(--ui-scale))");
    expect(iconBody!).toContain("stroke-width: 1.85");
  });

  test("action rail is removed from normal row layout", () => {
    const body = extractRule(css, ".task-row-actions");
    expect(body).not.toBeNull();
    expect(body!).toContain("position: absolute");
    expect(body!).toContain("right: 0");
    expect(body!).toContain("width: var(--task-row-actions-width)");
    expect(body!).toContain("transform: translateY(-50%)");
  });

  test("hover/focus reveal restores opacity and pointer events", () => {
    const body = extractRule(
      css,
      '.task-row-mini:hover .oc-button[data-ui="task-row-delete"]',
    );
    expect(body).not.toBeNull();
    expect(body!).toContain("opacity: var(--ui-opacity-full)");
    expect(body!).toContain("pointer-events: auto");
  });

  test("hover/focus action slot expands the right grid track", () => {
    const body = extractRule(css, ".task-row-mini:has(.task-row-actions):hover");
    expect(body).not.toBeNull();
    expect(body!).toContain("var(--task-row-actions-width)");
  });

  test("hover/focus hides the timestamp while actions are visible", () => {
    const body = extractRule(css, ".task-row-mini:has(.task-row-actions):hover .task-row-stamp");
    expect(body).not.toBeNull();
    expect(body!).toContain("opacity: 0");
  });

  test("reveal selector group covers all five button kinds across hover/focus states", () => {
    const stripped = stripCssComments(css);
    const expected = [
      '.task-row-mini:hover .oc-button[data-ui="task-row-delete"]',
      '.task-row-mini:focus-within .oc-button[data-ui="task-row-delete"]',
      '.task-row-mini:hover .oc-button[data-ui="task-row-cancel"]',
      '.task-row-mini:focus-within .oc-button[data-ui="task-row-cancel"]',
      '.task-row-mini:hover .oc-button[data-ui="task-row-rename"]',
      '.task-row-mini:focus-within .oc-button[data-ui="task-row-rename"]',
      '.task-row-mini:hover .oc-button[data-ui="task-row-download"]',
      '.task-row-mini:focus-within .oc-button[data-ui="task-row-download"]',
      '.task-row-mini:hover .oc-button[data-ui="task-row-start-now"]',
      '.task-row-mini:focus-within .oc-button[data-ui="task-row-start-now"]',
    ];
    for (const selector of expected) {
      expect(stripped).toContain(selector);
    }
    expect(stripped).not.toContain('.task-row-mini[data-active="true"] .oc-button[data-ui="task-row-delete"]');
    expect(stripped).not.toContain('.task-row-mini[data-active="true"] .oc-button[data-ui="task-row-cancel"]');
    expect(stripped).not.toContain('.task-row-mini[data-active="true"] .oc-button[data-ui="task-row-rename"]');
    expect(stripped).not.toContain('.task-row-mini[data-active="true"] .oc-button[data-ui="task-row-download"]');
    expect(stripped).not.toContain('.task-row-mini[data-active="true"] .oc-button[data-ui="task-row-start-now"]');
  });
});
