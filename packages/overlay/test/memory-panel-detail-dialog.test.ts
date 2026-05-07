import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MEMORY_PANEL_SOURCE = join(import.meta.dir, "..", "src", "components", "MemoryPanel.tsx");

describe("MemoryDetailDialog load lifecycle", () => {
  const source = readFileSync(MEMORY_PANEL_SOURCE, "utf8");

  test("detail fetch is driven by createEffect instead of a render-path call", () => {
    expect(source).toContain("createEffect(() => {");
    expect(source).toContain("props.fileId;");
    expect(source).toContain("void load();");
    expect(source).not.toMatch(/\n\s*load\(\);\s*\n\s*return \(/);
  });
});
