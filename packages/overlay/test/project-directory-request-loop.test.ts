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
    expect(source).toContain("loadSkillMarket({ directory, isCurrentDirectory: sourceMatchesDirectory })")
    expect(source).toContain("if (sourceMatchesDirectory(directory)) setLoadedMarketDirectory(directory)")
    expect(source).not.toContain("market().length === 0")
  })

  test("MCP panel refreshes while active so external backend connection changes surface", () => {
    const source = read("src/components/settings/SkillMarketPanel.tsx")
    expect(source).toContain("createVisibilityInterval")
    expect(source).toContain("MCP_STATUS_REFRESH_INTERVAL_MS")
    expect(source).not.toContain("function requireActiveDirectory()")
    expect(source).toContain('props.mode !== "mcp" || props.active !== true')
    expect(source).toContain("function currentDirectory()")
    expect(source).toContain("configureApi({ directory })")
    expect(source).toContain("const directory = currentDirectory()")
    expect(source).toContain("if (props.active !== true) return")
    expect(source).toContain('setPanelNotice(t("workspace.no_directory"), "warn")')
    const mcpPanelStart = source.indexOf("export function McpPanel")
    const mcpPanelEnd = source.indexOf("export function SkillMarketPanel", mcpPanelStart)
    const mcpPanelBlock = source.slice(mcpPanelStart, mcpPanelEnd)
    expect(mcpPanelBlock).toContain('mode="mcp"')
    expect(mcpPanelBlock).toContain("active={props.active ?? true}")
    expect(source).toContain("refreshMcpStatus({ directory }).catch")
    expect(source).toContain(
      "const mcp = createMemo((): Record<string, McpItem> => (mcpPanelActive() ? { ...(appStore.mcp",
    )
    expect(source).not.toContain("panelMcp")
    expect(source).not.toContain("setPanelMcp")
    expect(source).toContain("if (!props.compact) return")
    expect(source).toContain('if (props.mode === "mcp")')
    expect(source).toContain("mcpConnectionStatusOrDisabledLabel")
    expect(source).toContain("mcpConnectionStatusOrDisabledTone")
    expect(source).not.toContain("function mcpStatusLabel")
    expect(source).not.toContain("function mcpStatusTone")
    expect(source).not.toContain("function handleConnectMcp")
    expect(source).not.toContain('t("mcp.connect_action")')
    expect(source).toContain("interval.dispose()")
    expect(source).not.toContain("hasConnectingMcp")
  })

  test("installed skill panel refresh is scoped away from MCP status", () => {
    const source = read("src/components/settings/SkillMarketPanel.tsx")
    const main = read("src/main.tsx")
    expect(source).toContain('props.mode !== "skill" || props.active !== true')
    expect(source).toContain("if (props.active !== true) return")
    expect(source).toContain("const directory = currentDirectory()")
    expect(source).toContain('setPanelNotice(t("workspace.no_directory"), "warn")')
    expect(source).toContain("refreshSkillMounts({ directory }).catch")
    expect(source).toContain(
      "const skills = createMemo((): SkillItem[] => (skillPanelActive() ? [...(appStore.skills",
    )
    expect(source).not.toContain("panelSkills")
    expect(source).not.toContain("setPanelSkills")
    expect(source).toContain('if (props.mode === "skill")')
    expect(source).toContain('if (props.mode === "skill-market")')
    expect(source).toContain('mode="skill"')
    expect(source).toContain("active={props.active ?? true}")
    expect(main).toContain(
      '<SkillsPanel active={selectedLeftPanelActivity() === "skill"} directory={activeDirectory} compact />',
    )
    expect(main).toContain(
      '<McpPanel active={selectedLeftPanelActivity() === "mcp"} directory={activeDirectory} compact />',
    )
    expect(main).not.toContain('<SkillsPanel active={selectedLeftPanelActivity() === "skill"} compact />')
    expect(main).not.toContain('<McpPanel active={selectedLeftPanelActivity() === "mcp"} compact />')
    expect(main).toContain('active={selectedLeftPanelActivity() === "memory"}')
    expect(main).toContain("directory={activeDirectory}")
  })

  test("settings skill and MCP panels receive the active project directory explicitly", () => {
    const source = read("src/components/ConfigDialogHost.tsx")
    expect(source).toContain('import { activeProjectDirectory } from "../services/project-directory"')
    expect(source).toContain("<SkillsPanel directory={activeProjectDirectory} />")
    expect(source).toContain("<SkillMarketPanel active={true} directory={activeProjectDirectory} />")
    expect(source).toContain("<McpPanel directory={activeProjectDirectory} />")
    expect(source).not.toContain("return <SkillsPanel />")
    expect(source).not.toContain("return <McpPanel />")
  })

  test("compact skill and MCP panels do not materialize hidden matrix/list projections", () => {
    const source = read("src/components/settings/SkillMarketPanel.tsx")
    expect(source).toContain("const panelActive = createMemo(() => props.active === true)")
    expect(source).toContain('const skillPanelActive = createMemo(() => props.mode === "skill" && panelActive())')
    expect(source).toContain('const mcpPanelActive = createMemo(() => props.mode === "mcp" && panelActive())')
    expect(source).toContain(
      'const marketPanelActive = createMemo(() => props.mode === "skill-market" && panelActive())',
    )
    expect(source).toContain("const mounts = createMemo(() => (skillPanelActive() ? skillMountMatrix(appStore.skillMounts) : undefined))")
    expect(source).toContain("<Show when={skillPanelActive()}>")
    expect(source).toContain("<Show when={mcpPanelActive()}>")
    expect(source).toContain("<Show when={marketPanelActive()}>")
  })

  test("memory panel sends the active directory on every memory request", () => {
    const source = read("src/components/MemoryPanel.tsx")
    expect(source).toContain("function memoryPath(path: string, directory: string")
    expect(source).toContain('query.set("directory", directory)')
    expect(source).toContain("const [filesSource, setFilesSource] = createSignal<MemoryFilesSource | null>(null)")
    expect(source).toContain("setFilesSource({ taskID, directory })")
    expect(source).toContain('apiJson(memoryPath("panel/knowledge/memory", directory, { taskID }))')
    expect(source).toContain('apiJson(memoryPath("panel/knowledge/memory/search", directory)')
    expect(source).toContain("const handleDeleteInline = async (fileId: string, source = filesSource())")
    expect(source).toContain("memoryPath(`panel/knowledge/memory/${encodeURIComponent(fileId)}`, source.directory)")
    expect(source).toContain("disabled={!filesSourceActive()}")
    expect(source).toContain("sourceMatches(taskID, directory)")
    expect(source).toContain("if (errorMessage()) return errorMessage()")
    expect(source).toContain("if (!isActive()) return")
    expect(source).not.toContain("if (!isActive() && !props.compact) return")
  })

  test("extension loaders surface request failures instead of rewriting stores to empty values", () => {
    const source = read("src/services/extensions.ts")
    expect(source).toContain("export async function loadInstalledSkills(options: DirectoryOwnedRequestOptions = {})")
    expect(source).toContain("export async function loadMcpStatus(options: DirectoryOwnedRequestOptions = {})")
    expect(source).toContain("const [matrix, mcp] = await Promise.all([loadSkillMountMatrix(options), loadMcpStatus(options)])")
    expect(source).toContain("export async function loadSkillMarket(options: DirectoryOwnedRequestOptions = {})")
    expect(source).toContain("function ownsDirectoryRequest(options: DirectoryOwnedRequestOptions): boolean")
    expect(source).toContain("return { skills: matrix.skills, mcp }")
    expect(source).toContain("return skills")
    expect(source).toContain("return mcp")
    expect(source).toContain("if (ownsDirectoryRequest(options)) setSkills(skills)")
    expect(source).toContain("if (ownsDirectoryRequest(options)) setMcp(mcp)")
    expect(source).toContain("if (ownsDirectoryRequest(options)) setSkillMarket(items)")
    expect(source).toContain('apiJson(directoryOwnedPath("skill/installed", options))')
    expect(source).not.toContain('apiJson("skill/installed")')
    expect(source).not.toContain('apiJson("skill")')
    expect(source).not.toContain("setSkills([])")
    expect(source).not.toContain("setMcp({})")
    expect(source).not.toContain("setSkillMarket([])")
  })

  test("Skill and MCP panel has one store source and does not swallow destructive MCP failures", () => {
    const source = read("src/components/settings/SkillMarketPanel.tsx")
    expect(source).toContain(
      "const skills = createMemo((): SkillItem[] => (skillPanelActive() ? [...(appStore.skills",
    )
    expect(source).toContain(
      "const mcp = createMemo((): Record<string, McpItem> => (mcpPanelActive() ? { ...(appStore.mcp",
    )
    expect(source).toContain("function sourceMatchesDirectory(directory: string): boolean")
    expect(source).toContain("return await loadSkillMountMatrix({")
    expect(source).toContain("directory,")
    expect(source).toContain("isCurrentDirectory: sourceMatchesDirectory")
    expect(source).toContain("await reloadCurrentPanel({ refreshSkills: true })")
    expect(source).toContain("return (await loadMcpStatus({ directory, isCurrentDirectory: sourceMatchesDirectory })) as Record<string, McpItem>")
    expect(source).toContain("if (!directory || loadedMarketDirectory() !== directory) return")
    expect(source).toContain("deleteAllSkills,")
    expect(source).toContain("await deleteAllSkills({ directory, isCurrentDirectory: sourceMatchesDirectory, skills: list })")
    expect(source).toContain('import { addMcpServer, deleteAllMcp } from "../../services/mcp"')
    expect(source).toContain("await deleteAllMcp({ directory, isCurrentDirectory: sourceMatchesDirectory, names })")
    expect(source).toContain("await updateConfig((current: any) => {")
    expect(source).toContain("}, { directory, isCurrentDirectory: sourceMatchesDirectory })")
    expect(source).toContain("await addMcpServer(")
    expect(source).toContain("{ directory, isCurrentDirectory: sourceMatchesDirectory },")
    expect(source).not.toContain("panelSkills")
    expect(source).not.toContain("panelMcp")
    expect(source).not.toContain(".catch(() => void 0)")
    expect(source).toContain('nativeConfirm(t("mcp.delete_all_confirm"')
    expect(source).not.toContain("confirm(")
    expect(source).not.toContain("window.confirm")
  })

  test("project config UI writes capture the initiating directory", () => {
    const executorSelector = read("src/components/ExecutorSelector.tsx")
    const commandPalette = read("src/components/CommandPalette.tsx")
    const titlebar = read("src/components/titlebar/TitlebarMenubar.tsx")
    const channelsPanel = read("src/components/settings/ChannelsPanel.tsx")
    const networkPanel = read("src/components/settings/NetworkPanel.tsx")
    const permissionsPanel = read("src/components/settings/PermissionsPanel.tsx")
    const agentModelsPanel = read("src/components/settings/AgentModelsPanel.tsx")
    const generalPanel = read("src/components/settings/GeneralPanel.tsx")

    expect(executorSelector).toContain("patchConfig({ model: value ? value : null }, currentProjectConfigRequestOptions())")
    expect(commandPalette).toContain("syncAgentPromptLocale(loc.id, currentProjectConfigRequestOptions())")
    expect(titlebar).toContain("patchConfig({ assistant: { max_executor_groups: value } }, currentProjectConfigRequestOptions())")
    expect(titlebar).toContain("patchConfig({ compaction: { threshold: ratio } }, currentProjectConfigRequestOptions())")
    expect(titlebar).toContain("handlePatchAutoQuestion")
    expect(titlebar).toContain("syncAgentPromptLocale(value, currentProjectConfigRequestOptions())")
    expect(channelsPanel.match(/currentProjectConfigRequestOptions\(\)/g)?.length).toBeGreaterThanOrEqual(2)
    expect(networkPanel).toContain(
      "patchConfig({ network: { proxy: nextProxy } }, currentProjectConfigRequestOptions())",
    )
    expect(networkPanel).toContain("patchConfig({ network: { proxy: null } }, currentProjectConfigRequestOptions())")
    expect(permissionsPanel).toContain("const options = currentProjectConfigRequestOptions()")
    expect(permissionsPanel).toContain("patchConfig({ tool_permissions: { [key]: action } }, options)")
    expect(agentModelsPanel).toContain("return await patchConfig(diff, currentProjectConfigRequestOptions())")
    expect(generalPanel).toContain("currentProjectConfigRequestOptions()")
  })

  test("prompt catalog config helpers require an owning directory", () => {
    const configService = read("src/services/config.ts")

    expect(configService).toContain("function requirePromptCatalogDirectory(directory: string): string")
    expect(configService).toContain("export async function loadPromptCatalog(directory: string): Promise<void>")
    expect(configService).toContain("export async function savePromptEntry(entry: any, value: string, directory: string)")
    expect(configService).toContain("export async function resetPromptEntry(entry: any, directory: string)")
    expect(configService).toContain("await loadPromptCatalog(owningDirectory)")
    expect(configService).toContain("}, { directory: owningDirectory })")
    expect(configService).not.toContain('apiJson("config/prompt")')
  })

  test("skill mount matrix state is directory-owned and cleared on project switches", () => {
    const service = read("src/services/extensions.ts")
    const panel = read("src/components/settings/SkillMarketPanel.tsx")
    const workspace = read("src/services/workspace.ts")
    expect(service).toContain("interface SkillMountRequestOptions")
    expect(service).toContain("function commitOwnedSkillMountMatrix")
    expect(service).toContain("if (directory && options.isCurrentDirectory && !options.isCurrentDirectory(directory)) return matrix")
    expect(service).toContain('skillMountPath("skill/mount", options)')
    expect(service).toContain('skillMountPath("skill/unmount", options)')
    expect(service).toContain('skillMountPath("skill/import-and-mount", options)')
    expect(panel).toContain("await mountSkill(agent, skill, { directory, isCurrentDirectory: sourceMatchesDirectory })")
    expect(panel).toContain("await unmountSkill(agent, skill, { directory, isCurrentDirectory: sourceMatchesDirectory })")
    expect(panel).toContain("await importAndMountSkill(agent, body, { directory, isCurrentDirectory: sourceMatchesDirectory })")
    expect(workspace).toContain("skillMounts: null")
  })

  test("Skill delete-all uses the extension service and refreshes partial-failure projection", () => {
    const panel = read("src/components/settings/SkillMarketPanel.tsx")
    const service = read("src/services/extensions.ts")
    const start = panel.indexOf("async function handleDeleteAllSkills()")
    const end = panel.indexOf("async function handleDeleteAllMcp()", start)
    const block = panel.slice(start, end)
    expect(block).toContain("await deleteAllSkills({ directory, isCurrentDirectory: sourceMatchesDirectory, skills: list })")
    expect(block).not.toContain('apiJson("skill/remove"')
    expect(service).toContain("export async function deleteAllSkills(")
    expect(service).toContain("let removalError: unknown")
    expect(service).toContain("await loadInstalledSkills(options)")
    expect(service).toContain("if (removalError) throw removalError")
  })

  test("Skill panel convenience actions surface host and API failures", () => {
    const source = read("src/components/settings/SkillMarketPanel.tsx")
    expect(source).toContain("function requireManagedSkillDirectory")
    expect(source).toContain("const target = requireManagedSkillDirectory(dirs)")
    expect(source).toContain('setPanelNotice(t("skill.open_failed"')
    expect(source).toContain('setPanelNotice(t("skill.pick_folder_failed"')
    expect(source).toContain('setPanelNotice(t("skill.open_dir_failed"')
    expect(source).not.toContain("global_config ||")
    expect(source).not.toContain("catch {\n      // ignore")
  })
})
