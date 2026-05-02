import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_SETTINGS, DEFAULT_THEME } from "../src/store/settings";
import { sanitizeTheme } from "../src/services/theme";

describe("overlay default theme", () => {
  test("settings and sanitizers default to reference light style", () => {
    expect(DEFAULT_THEME).toBe("light");
    expect(DEFAULT_SETTINGS.theme).toBe(DEFAULT_THEME);
    expect(sanitizeTheme(undefined)).toBe(DEFAULT_THEME);
    expect(sanitizeTheme("not-a-theme")).toBe(DEFAULT_THEME);
  });

  test("pre-render theme bootstrap defaults cold starts to reference light style", async () => {
    const html = await fs.readFile(
      path.join(import.meta.dir, "..", "src", "index.html"),
      "utf8",
    );
    expect(html).toContain('<html lang="en-US" data-theme="light">');
    expect(html).toContain('<body data-page="overlay" data-theme="light">');
    expect(html).toContain('!saved ? "light"');
    expect(html).toContain('document.documentElement.dataset.theme = effective');
    expect(html).toContain('document.body.dataset.theme = "light"');
  });

  test("palette-only theme files are on the runtime path", async () => {
    const html = await fs.readFile(
      path.join(import.meta.dir, "..", "src", "index.html"),
      "utf8",
    );
    for (const theme of ["light", "dark", "vscode-dark"]) {
      expect(html).toContain(`styles/themes/${theme}.css`);
    }
  });

  test("applyTheme writes the root palette attribute and legacy body attribute", async () => {
    const source = await fs.readFile(
      path.join(import.meta.dir, "..", "src", "services", "theme.ts"),
      "utf8",
    );
    expect(source).toContain("document.documentElement.dataset.theme = effective");
    expect(source).toContain("document.body.dataset.theme = effective");
  });
});
