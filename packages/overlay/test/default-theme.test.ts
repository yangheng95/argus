import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_SETTINGS, DEFAULT_THEME } from "../src/store/settings";
import { sanitizeTheme } from "../src/services/theme";

describe("overlay default theme", () => {
  test("settings and sanitizers default to Nova light", () => {
    expect(DEFAULT_THEME).toBe("light");
    expect(DEFAULT_SETTINGS.theme).toBe(DEFAULT_THEME);
    expect(sanitizeTheme(undefined)).toBe(DEFAULT_THEME);
    expect(sanitizeTheme("not-a-theme")).toBe(DEFAULT_THEME);
  });

  test("pre-render theme bootstrap defaults cold starts to Nova light", async () => {
    const html = await fs.readFile(
      path.join(import.meta.dir, "..", "src", "index.html"),
      "utf8",
    );
    expect(html).toContain('!saved ? "light"');
    expect(html).toContain('document.body.dataset.theme = "light"');
  });
});
