import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const LAUNCHER_SOURCE = readFileSync(
  join(import.meta.dir, "../src/components/WorkspaceSplitLauncher.tsx"),
  "utf8",
);

describe("WorkspaceSplitLauncher primitive", () => {
  test("delegates menu behavior to Kobalte dropdown menu", () => {
    expect(LAUNCHER_SOURCE).toContain(
      'import * as DropdownMenu from "@kobalte/core/dropdown-menu";',
    );
    expect(LAUNCHER_SOURCE).toContain("<DropdownMenu.Root");
    expect(LAUNCHER_SOURCE).toContain("<DropdownMenu.Trigger");
    expect(LAUNCHER_SOURCE).toContain("<DropdownMenu.Portal");
    expect(LAUNCHER_SOURCE).toContain("<DropdownMenu.Content");
    expect(LAUNCHER_SOURCE).toContain("<DropdownMenu.Item");
    expect(LAUNCHER_SOURCE).not.toContain("document.addEventListener");
    expect(LAUNCHER_SOURCE).not.toContain("getBoundingClientRect");
    expect(LAUNCHER_SOURCE).not.toContain('from "solid-js/web"');
  });
});
