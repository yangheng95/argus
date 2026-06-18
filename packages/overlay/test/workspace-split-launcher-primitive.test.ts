import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const LAUNCHER_SOURCE = readFileSync(join(import.meta.dir, "../src/components/WorkspaceSplitLauncher.tsx"), "utf8")

describe("WorkspaceSplitLauncher primitive", () => {
  test("delegates menu behavior to Kobalte dropdown menu", () => {
    expect(LAUNCHER_SOURCE).toMatch(/import\s+\*\s+as\s+DropdownMenu\s+from\s+["']@kobalte\/core\/dropdown-menu["'];?/)
    expect(LAUNCHER_SOURCE).toContain('import { Button } from "./ui/Button"')
    expect(LAUNCHER_SOURCE).toContain("<DropdownMenu.Root")
    expect(LAUNCHER_SOURCE).toContain("<Button")
    expect(LAUNCHER_SOURCE).toContain("<DropdownMenu.Trigger")
    expect(LAUNCHER_SOURCE).toContain("as={Button}")
    expect(LAUNCHER_SOURCE).toContain("<DropdownMenu.Portal")
    expect(LAUNCHER_SOURCE).toContain("<DropdownMenu.Content")
    expect(LAUNCHER_SOURCE).toContain("<DropdownMenu.Item")
    expect(LAUNCHER_SOURCE).not.toContain("<button")
    expect(LAUNCHER_SOURCE).not.toContain("workspace-split-launcher-primary")
    expect(LAUNCHER_SOURCE).not.toContain("workspace-split-launcher-menu-button")
    expect(LAUNCHER_SOURCE).not.toContain("primaryClass")
    expect(LAUNCHER_SOURCE).not.toContain("menuButtonClass")
    expect(LAUNCHER_SOURCE).not.toContain("document.addEventListener")
    expect(LAUNCHER_SOURCE).not.toContain("getBoundingClientRect")
    expect(LAUNCHER_SOURCE).not.toContain('from "solid-js/web"')
  })
})
