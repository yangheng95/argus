import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const OVERLAY_ROOT = join(import.meta.dir, "..")

function read(path: string): string {
  return readFileSync(join(OVERLAY_ROOT, path), "utf8")
}

describe("overlay project directory request loop", () => {
  test("API configuration waits for settings hydration before reading active directory", () => {
    const source = read("src/main.tsx")
    expect(source).toMatch(/createEffect\(\(\) => \{\s*if \(!settingsHydrated\(\)\) return\s*configureApi\(\{/)
  })

  test("skill market auto-load is keyed by active directory, not empty catalogue state", () => {
    const source = read("src/components/settings/SkillMarketPanel.tsx")
    expect(source).toContain('const [loadedMarketDirectory, setLoadedMarketDirectory] = createSignal("")')
    expect(source).toContain("const directory = currentDirectory()")
    expect(source).toContain('props.mode !== "skill-market" || props.active !== true')
    expect(source).toContain("if (loadedMarketDirectory() === directory) return")
    expect(source).not.toContain("market().length === 0")
  })

  test("MCP panel refreshes while active so external backend connection changes surface", () => {
    const source = read("src/components/settings/SkillMarketPanel.tsx")
    expect(source).toContain("createVisibilityInterval")
    expect(source).toContain("MCP_STATUS_REFRESH_INTERVAL_MS")
    expect(source).toContain("function requireActiveDirectory()")
    expect(source).toContain('props.mode !== "mcp" || props.active !== true')
    expect(source).toContain("function currentDirectory()")
    expect(source).toContain("configureApi({ directory })")
    expect(source).toContain("const directory = currentDirectory()")
    expect(source).toContain('setPanelNotice(t("workspace.no_directory"), "warn")')
    expect(source).toContain('mode="mcp" active={props.active ?? true}')
    expect(source).toContain("refreshMcpStatus().catch")
    expect(source).toContain("setPanelMcp(status as Record<string, McpItem>)")
    expect(source).toContain("interval.dispose()")
    expect(source).not.toContain("hasConnectingMcp")
  })

  test("installed skill panel refresh is scoped away from MCP status", () => {
    const source = read("src/components/settings/SkillMarketPanel.tsx")
    const main = read("src/main.tsx")
    expect(source).toContain('props.mode !== "skill" || props.active !== true')
    expect(source).toContain("const directory = currentDirectory()")
    expect(source).toContain('setPanelNotice(t("workspace.no_directory"), "warn")')
    expect(source).toContain("refreshInstalledSkills().catch")
    expect(source).toContain("setPanelSkills(items as SkillItem[])")
    expect(source).toContain('mode="skill"')
    expect(source).toContain("active={props.active ?? true}")
    expect(main).toContain('<SkillsPanel active={selectedLeftPanelActivity() === "skill"} directory={activeDirectory} compact />')
    expect(main).toContain('<McpPanel active={selectedLeftPanelActivity() === "mcp"} directory={activeDirectory} compact />')
    expect(main).toContain('active={selectedLeftPanelActivity() === "memory"}')
    expect(main).toContain("directory={activeDirectory}")
  })

  test("memory panel sends the active directory on every memory request", () => {
    const source = read("src/components/MemoryPanel.tsx")
    expect(source).toContain("function memoryPath(path: string, directory: string")
    expect(source).toContain('query.set("directory", directory)')
    expect(source).toContain('apiJson(memoryPath("panel/knowledge/memory", directory, { taskID }))')
    expect(source).toContain('apiJson(memoryPath("panel/knowledge/memory/search", directory)')
    expect(source).toContain("memoryPath(`panel/knowledge/memory/${encodeURIComponent(fileId)}`, currentDirectory())")
    expect(source).toContain("if (errorMessage()) return errorMessage()")
  })

  test("extension loaders surface request failures instead of rewriting stores to empty values", () => {
    const source = read("src/services/extensions.ts")
    expect(source).toContain("export async function loadInstalledSkills()")
    expect(source).toContain("export async function loadMcpStatus()")
    expect(source).toContain("const [skills, mcp] = await Promise.all([loadInstalledSkills(), loadMcpStatus()])")
    expect(source).toContain("return { skills, mcp }")
    expect(source).toContain("return skills")
    expect(source).toContain("return mcp")
    expect(source).toContain('apiJson("skill/installed")')
    expect(source).not.toContain('apiJson("skill/installed").catch')
    expect(source).not.toContain('apiJson("skill")')
    expect(source).not.toContain("setSkills([])")
    expect(source).not.toContain("setMcp({})")
    expect(source).not.toContain("setSkillMarket([])")
  })
})
