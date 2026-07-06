import { AgentRoleContract, type AgentRoleID } from "@/agent/role-contract"
import { McpConfigSchema } from "@/config/mcp-schema"
import type { OrchestratorWorkflowToolName, SchedulerAgentWorkflowBinding } from "@/engine/workflow"
import { Filesystem } from "@/util/filesystem"
import type { Dirent } from "fs"
import { lstat, readdir, realpath } from "fs/promises"
import matter from "gray-matter"
import { parse as parseJsonc, type ParseError, printParseErrorCode } from "jsonc-parser"
import path from "path"
import z from "zod"

export namespace ExpertSquadRegistry {
  export const DIRECTORY = "expert-squads"
  export const MANIFEST = "expert-squad.jsonc"

  const TOP_LEVEL_FILES = new Set([MANIFEST, "README.md", "selector.md"])
  const TOP_LEVEL_DIRECTORIES = new Set(["agents", "skills", "tools", "mcp", "virtual-agents", "protocol-engine"])
  const RUNTIME_INTERNAL_ENTRIES = new Set([".opencorvus", "r", "runtime", "worktrees", ".opencorvus-meta.json"])

  const ID = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, "id must be kebab-case")
  const RelativePath = z.string().min(1)
  const Ref = z.string().min(1)
  const RefSegment = z.string().min(1).regex(/^[^/\\]+$/, "canonical ref segments cannot contain / or \\")
  const DisplayPrefix = z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[^\r\n/\\]+$/, "display prefix cannot contain line breaks or path separators")
  const ReadmeFrontMatter = z
    .object({
      expert_squad_display_prefix: DisplayPrefix.optional(),
    })
    .passthrough()

  const Selector = z
    .object({
      summary: z.string().min(1),
      selection_guidance: z.string().min(1),
      instructions: z.string().refine((value) => value === "selector.md", {
        message: "selector instructions must be top-level selector.md",
      }),
    })
    .strict()
    .optional()

  const AgentDefinition = z
    .object({
      prompt: RelativePath.optional(),
      skill_refs: z.array(Ref).optional().default([]),
      tool_refs: z.array(Ref).optional().default([]),
      mcp_server_refs: z.array(Ref).optional().default([]),
    })
    .strict()

  const VirtualAgentDefinition = z
    .object({
      id: ID,
      label: z.string().trim().min(1),
      description: z.string().trim().min(1).optional(),
      prompt: RelativePath,
    })
    .strict()

  const Projection = z
    .object({
      role_base: z.boolean().optional().default(false),
      built_in_tool_ids: z.array(Ref).optional().default([]),
      default_skill_refs: z.array(Ref).optional().default([]),
      package_skill_refs: z.array(Ref).optional().default([]),
      default_tool_refs: z.array(Ref).optional().default([]),
      package_tool_refs: z.array(Ref).optional().default([]),
      default_mcp_server_refs: z.array(Ref).optional().default([]),
      package_mcp_server_refs: z.array(Ref).optional().default([]),
      default_mcp_tool_refs: z.array(Ref).optional().default([]),
      package_mcp_tool_refs: z.array(Ref).optional().default([]),
      default_mcp_prompt_refs: z.array(Ref).optional().default([]),
      package_mcp_prompt_refs: z.array(Ref).optional().default([]),
      default_mcp_resource_refs: z.array(Ref).optional().default([]),
      package_mcp_resource_refs: z.array(Ref).optional().default([]),
    })
    .strict()

  const CapabilityProjection = z
    .object({
      scheduler: Projection,
      agents: z.record(z.string(), Projection).optional().default({}),
    })
    .strict()

  const FrontendDesignDynamicAttributes = z
    .object({
      require_design_direction_contract: z.boolean().optional().default(false),
    })
    .strict()

  const DynamicAttributes = z
    .object({
      frontend_design: FrontendDesignDynamicAttributes.optional().default({
        require_design_direction_contract: false,
      }),
    })
    .strict()

  const Manifest = z
    .object({
      schema_version: z.literal(1),
      id: ID,
      label: z.string().min(1),
      description: z.string().optional(),
      version: z.string().min(1).optional(),
      readme: z.literal("README.md"),
      selector: Selector,
      capability_projection: CapabilityProjection,
      dynamic_attributes: DynamicAttributes.optional().default({
        frontend_design: { require_design_direction_contract: false },
      }),
      agents: z.record(z.string(), AgentDefinition).default({}),
      virtual_agents: z.record(z.string(), VirtualAgentDefinition).default({}),
    })
    .strict()

  export type Manifest = z.infer<typeof Manifest>
  export type Projection = z.infer<typeof Projection>
  export type VirtualAgentDefinition = z.infer<typeof VirtualAgentDefinition>

  export function parseID(value: string, context = "expert squad id") {
    const parsed = ID.safeParse(value)
    if (!parsed.success) throw new Error(`${context}: invalid expert squad id "${value}"`)
    return parsed.data
  }

  export function isRuntimeInternalEntry(name: string, isDirectory: boolean) {
    return name === ".opencorvus-meta.json" || (isDirectory && RUNTIME_INTERNAL_ENTRIES.has(name))
  }

  export interface SelectorMetadata {
    ref: string
    id: string
    label: string
    description?: string
    summary: string
    selection_guidance: string
  }

  export interface PackageCatalogEntry {
    id: string
    label: string
    description?: string
    version?: string
    displayPrefix?: string
    selector?: SelectorMetadata
    selectorInstructions?: string
  }

  export interface PackageLocation extends PackageCatalogEntry {
    root: string
    manifestPath: string
    readmePath: string
    readmeContent: string
  }

  export interface LoadedPackage extends PackageLocation {
    manifest: Manifest
    selectorInstructions?: string
    promptProfile: {
      label: string
      description?: string
      agents: Record<string, string>
      virtualAgents: Record<string, VirtualAgentDefinition & { promptContent: string }>
    }
    packageSkillRefs: Set<string>
    packageToolRefs: Set<string>
    packageMcpServerRefs: Set<string>
    packageMcpToolRefs: Set<string>
    packageMcpPromptRefs: Set<string>
    packageMcpResourceRefs: Set<string>
    explicitSchedulerWorkflowTools: OrchestratorWorkflowToolName[]
  }

  export interface CatalogPackage extends PackageLocation {
    manifest: Manifest
    selectorInstructions?: string
    promptProfile: {
      label: string
      description?: string
      agents: Record<string, string>
      virtualAgents: Record<string, VirtualAgentDefinition & { promptContent: string }>
    }
  }

  export interface EmbeddedPackageSource {
    id: string
    manifestText: string
    files: Record<string, string>
  }

  export interface EmbeddedPackage {
    id: string
    label: string
    description?: string
    version?: string
    displayPrefix?: string
    selector?: SelectorMetadata
    manifest: Manifest
    readmeContent: string
    selectorInstructions?: string
    promptProfile: {
      label: string
      description?: string
      agents: Record<string, string>
      virtualAgents: Record<string, VirtualAgentDefinition & { promptContent: string }>
    }
  }

  interface ParsedPackageMetadata extends PackageLocation {
    manifest: Manifest
  }

  interface DeclaredPackageRefs {
    skillRefs: Map<AgentRoleID, Set<string>>
    toolRefs: Map<AgentRoleID, Set<string>>
    mcpServerRefs: Map<AgentRoleID, Set<string>>
    virtualAgentRoles: Set<AgentRoleID>
  }

  function parseJsoncText(text: string, source: string): unknown {
    const errors: ParseError[] = []
    const parsed = parseJsonc(text, errors, { allowTrailingComma: true })
    if (errors.length) {
      const details = errors
        .map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`)
        .join("; ")
      throw new Error(`${source}: invalid JSONC: ${details}`)
    }
    return parsed
  }

  async function readJsoncFile(file: string): Promise<unknown> {
    return parseJsoncText(await Filesystem.readText(file), file)
  }

  export function parseManifestText(text: string, source: string): Manifest {
    return Manifest.parse(parseJsoncText(text, source))
  }

  function parseReadmeText(text: string, context: string): { content: string; displayPrefix?: string } {
    const parsed = matter(text)
    const frontMatter = ReadmeFrontMatter.safeParse(parsed.data ?? {})
    if (!frontMatter.success) {
      const details = frontMatter.error.issues.map((issue) => issue.message).join("; ")
      throw new Error(`${context}: invalid README front matter: ${details}`)
    }
    const content = parsed.content.trim()
    if (!content) throw new Error(`${context}: referenced file is blank`)
    return {
      content,
      displayPrefix: frontMatter.data.expert_squad_display_prefix,
    }
  }

  function assertRoleID(value: string, context: string): asserts value is AgentRoleID {
    if (!AgentRoleContract.isRoleID(value)) throw new Error(`${context}: unknown agent role "${value}"`)
  }

  function virtualAgentPromptPath(role: AgentRoleID) {
    return `virtual-agents/${role}/system.md`
  }

  function assertSafeManifestRelativePath(relativePath: string, context: string) {
    const segments = relativePath.split("/")
    if (
      !relativePath ||
      relativePath !== relativePath.trim() ||
      relativePath.includes("\\") ||
      relativePath.includes(":") ||
      path.isAbsolute(relativePath) ||
      path.win32.isAbsolute(relativePath) ||
      segments.some((segment) => !segment || segment === "." || segment === "..")
    ) {
      throw new Error(`${context}: unsafe relative path "${relativePath}"`)
    }
  }

  function assertSelectorInstructionsPath(relativePath: string, context: string) {
    assertSafeManifestRelativePath(relativePath, context)
    if (relativePath !== "selector.md") {
      throw new Error(`${context}: selector instructions must be top-level selector.md, got "${relativePath}"`)
    }
  }

  function assertContained(root: string, candidate: string, context: string) {
    if (!Filesystem.contains(root, candidate)) throw new Error(`${context}: path escapes expert squad package root`)
  }

  function resolveManifestPath(root: string, relativePath: string, context: string): string {
    assertSafeManifestRelativePath(relativePath, context)
    const segments = relativePath.split("/")
    const resolved = path.resolve(root, ...segments)
    assertContained(root, resolved, context)
    return resolved
  }

  async function assertFile(root: string, relativePath: string, context: string): Promise<string> {
    const resolved = resolveManifestPath(root, relativePath, context)
    const info = await lstat(resolved).catch(() => undefined)
    if (info?.isSymbolicLink()) throw new Error(`${context}: symbolic links are not allowed`)
    if (!info?.isFile()) throw new Error(`${context}: referenced file does not exist`)
    const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(resolved)])
    assertContained(realRoot, realTarget, context)
    return resolved
  }

  async function assertNonBlankFile(root: string, relativePath: string, context: string): Promise<string> {
    const resolved = await assertFile(root, relativePath, context)
    const content = await Filesystem.readText(resolved)
    if (!content.trim()) throw new Error(`${context}: referenced file is blank`)
    return resolved
  }

  function assertNoRuntimeInternalEntry(entry: Dirent, context: string) {
    if (isRuntimeInternalEntry(entry.name, entry.isDirectory())) {
      throw new Error(`${context}.${entry.name}: runtime-internal entry "${entry.name}" is not allowed`)
    }
  }

  async function readOptionalDirectoryEntries(dir: string, context: string): Promise<Dirent[]> {
    const info = await lstat(dir).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      throw error
    })
    if (!info) return []
    if (info.isSymbolicLink()) throw new Error(`${context}: symbolic links are not allowed`)
    if (!info.isDirectory()) throw new Error(`${context}: expected directory`)
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new Error(`${context}.${entry.name}: symbolic links are not allowed`)
      assertNoRuntimeInternalEntry(entry, context)
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name))
  }

  async function readRequiredDirectoryEntries(dir: string, context: string): Promise<Dirent[]> {
    const info = await lstat(dir).catch(() => undefined)
    if (info?.isSymbolicLink()) throw new Error(`${context}: symbolic links are not allowed`)
    if (!info?.isDirectory()) throw new Error(`${context}: expected directory`)
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new Error(`${context}.${entry.name}: symbolic links are not allowed`)
      assertNoRuntimeInternalEntry(entry, context)
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name))
  }

  async function collectFileEntries(dir: string, context: string): Promise<string[]> {
    const entries = await readOptionalDirectoryEntries(dir, context)
    for (const entry of entries) {
      if (!entry.isFile()) throw new Error(`${context}.${entry.name}: expected file`)
    }
    return entries.map((entry) => entry.name)
  }

  async function validatePackageRoot(root: string) {
    const entries = await readRequiredDirectoryEntries(root, "expert squad package root")
    const names = new Set(entries.map((entry) => entry.name))
    if (!names.has(MANIFEST)) throw new Error(`expert squad package root: missing ${MANIFEST}`)
    if (!names.has("README.md")) throw new Error("expert squad package root: missing README.md")

    for (const entry of entries) {
      if (entry.isFile() && TOP_LEVEL_FILES.has(entry.name)) continue
      if (entry.isDirectory() && TOP_LEVEL_DIRECTORIES.has(entry.name)) continue
      if (RUNTIME_INTERNAL_ENTRIES.has(entry.name)) {
        throw new Error(`expert squad package root: runtime-internal entry "${entry.name}" is not allowed`)
      }
      if (TOP_LEVEL_FILES.has(entry.name)) {
        throw new Error(`expert squad package root: top-level entry "${entry.name}" must be a file`)
      }
      if (TOP_LEVEL_DIRECTORIES.has(entry.name)) {
        throw new Error(`expert squad package root: top-level entry "${entry.name}" must be a directory`)
      }
      throw new Error(`expert squad package root: unknown top-level entry "${entry.name}"`)
    }
  }

  async function validatePackageTree(root: string) {
    async function walk(current: string, context: string) {
      for (const entry of await readRequiredDirectoryEntries(current, context)) {
        if (entry.isDirectory()) await walk(path.join(current, entry.name), `${context}.${entry.name}`)
      }
    }

    await walk(root, "expert squad package tree")
  }

  function addRef(set: Set<string>, ref: string, context: string) {
    if (set.has(ref)) throw new Error(`${context}: duplicate package ref "${ref}"`)
    set.add(ref)
  }

  function assertCanonicalRefSegment(value: string, context: string) {
    if (!RefSegment.safeParse(value).success) throw new Error(`${context}: invalid canonical ref segment "${value}"`)
  }

  function relativeRefSegment(root: string, current: string, context: string): string {
    const relative = path.relative(root, current).split(path.sep).join("/")
    if (!relative || relative.startsWith("../") || relative === "..") {
      throw new Error(`${context}: SKILL.md must live inside a named skill directory`)
    }
    return relative
  }

  async function collectSkillRefs(root: string, refBase: string, set: Set<string>, context: string) {
    const rootEntries = await readOptionalDirectoryEntries(root, context)
    if (!rootEntries.length) return

    async function walk(current: string, entries: Dirent[]) {
      const hasSkillFile = entries.some((entry) => entry.isFile() && entry.name === "SKILL.md")
      if (hasSkillFile) addRef(set, `${refBase}/${relativeRefSegment(root, current, context)}`, context)

      for (const entry of entries) {
        const child = path.join(current, entry.name)
        if (entry.isDirectory()) {
          await walk(child, await readRequiredDirectoryEntries(child, `${context}.${entry.name}`))
          continue
        }
        if (current === root) {
          throw new Error(`${context}.${entry.name}: unexpected file outside a named skill directory`)
        }
      }
    }

    await walk(root, rootEntries)
  }

  async function collectPackageRefs(root: string, id: string) {
    const skillRefs = new Set<string>()
    const toolRefs = new Set<string>()
    const mcpServerRefs = new Set<string>()
    const mcpToolRefs = new Set<string>()
    const mcpPromptRefs = new Set<string>()
    const mcpResourceRefs = new Set<string>()

    const agentRoot = path.join(root, "agents")
    for (const agentEntry of await readOptionalDirectoryEntries(agentRoot, "agents")) {
      if (!agentEntry.isDirectory()) throw new Error(`agents.${agentEntry.name}: expected directory`)
      const agent = agentEntry.name
      assertRoleID(agent, `agents.${agent}`)
      const base = `${id}/${agent}`
      await collectSkillRefs(path.join(agentRoot, agent, "skills"), base, skillRefs, `agents.${agent}.skills`)
      for (const tool of await collectFileEntries(path.join(agentRoot, agent, "tools"), `agents.${agent}.tools`)) {
        if (!/\.(?:js|ts)$/.test(tool)) throw new Error(`agents.${agent}.tools.${tool}: unsupported tool extension`)
        const toolID = tool.replace(/\.(?:js|ts)$/, "")
        assertCanonicalRefSegment(toolID, `agents.${agent}.tools.${tool}`)
        addRef(toolRefs, `${base}/${toolID}`, `agents.${agent}.tools`)
      }
      await collectMcpRefs(path.join(agentRoot, agent, "mcp"), `${base}`, {
        mcpServerRefs,
        mcpToolRefs,
        mcpPromptRefs,
        mcpResourceRefs,
      })
    }

    await collectSkillRefs(path.join(root, "skills"), `${id}/shared`, skillRefs, "skills")
    for (const tool of await collectFileEntries(path.join(root, "tools"), "tools")) {
      if (!/\.(?:js|ts)$/.test(tool)) throw new Error(`tools.${tool}: unsupported tool extension`)
      const toolID = tool.replace(/\.(?:js|ts)$/, "")
      assertCanonicalRefSegment(toolID, `tools.${tool}`)
      addRef(toolRefs, `${id}/shared/${toolID}`, "tools")
    }
    await collectMcpRefs(path.join(root, "mcp"), `${id}/shared`, {
      mcpServerRefs,
      mcpToolRefs,
      mcpPromptRefs,
      mcpResourceRefs,
    })

    return { skillRefs, toolRefs, mcpServerRefs, mcpToolRefs, mcpPromptRefs, mcpResourceRefs }
  }

  const McpCapabilities = z
    .object({
      tools: z.array(RefSegment).optional().default([]),
      prompts: z.array(RefSegment).optional().default([]),
      resources: z.array(RefSegment).optional().default([]),
    })
    .strict()
    .optional()
    .default({ tools: [], prompts: [], resources: [] })

  export const McpDefinition = z.discriminatedUnion("type", [
    McpConfigSchema.McpLocal.extend({ capabilities: McpCapabilities }),
    McpConfigSchema.McpRemote.extend({ capabilities: McpCapabilities }),
  ])
  export type McpDefinition = z.infer<typeof McpDefinition>

  export function parseMcpDefinitionText(text: string, source: string): McpDefinition {
    return McpDefinition.parse(parseJsoncText(text, source))
  }

  async function collectMcpRefs(
    dir: string,
    refBase: string,
    sets: {
      mcpServerRefs: Set<string>
      mcpToolRefs: Set<string>
      mcpPromptRefs: Set<string>
      mcpResourceRefs: Set<string>
    },
  ) {
    for (const file of await collectFileEntries(dir, dir)) {
      if (!/\.(?:json|jsonc)$/.test(file)) throw new Error(`${dir}/${file}: unsupported MCP definition extension`)
      const serverID = file.replace(/\.(?:json|jsonc)$/, "")
      assertCanonicalRefSegment(serverID, `${dir}/${file}`)
      const serverRef = `${refBase}/${serverID}`
      addRef(sets.mcpServerRefs, serverRef, dir)
      const raw = await readJsoncFile(path.join(dir, file))
      const capabilities = McpDefinition.parse(raw).capabilities
      for (const tool of capabilities.tools) addRef(sets.mcpToolRefs, `${serverRef}/tool/${tool}`, `${serverRef}.tools`)
      for (const prompt of capabilities.prompts) {
        addRef(sets.mcpPromptRefs, `${serverRef}/prompt/${prompt}`, `${serverRef}.prompts`)
      }
      for (const resource of capabilities.resources) {
        addRef(sets.mcpResourceRefs, `${serverRef}/resource/${resource}`, `${serverRef}.resources`)
      }
    }
  }

  function assertDefaultRef(ref: string, kind: string, context: string) {
    const pattern = new RegExp(`^default/${kind}/[^/\\\\]+$`)
    if (!pattern.test(ref)) {
      throw new Error(`${context}: default ${kind} ref "${ref}" must match default/${kind}/<name>`)
    }
  }

  function assertPackageRef(ref: string, id: string, available: Set<string>, context: string) {
    if (!ref.startsWith(`${id}/`)) throw new Error(`${context}: package ref "${ref}" must be namespaced by ${id}`)
    if (!available.has(ref)) throw new Error(`${context}: package ref "${ref}" is not declared in this package`)
  }

  function isSharedPackageRef(ref: string, id: string) {
    return ref.startsWith(`${id}/shared/`)
  }

  function assertProjectedPackageRef(input: {
    ref: string
    id: string
    available: Set<string>
    declaredByAgent: Map<AgentRoleID, Set<string>>
    virtualAgentRoles: ReadonlySet<AgentRoleID>
    role: AgentRoleID
    context: string
  }) {
    const { ref, id, available, declaredByAgent, virtualAgentRoles, role, context } = input
    assertPackageRef(ref, id, available, context)
    if (isSharedPackageRef(ref, id)) return
    if (!ref.startsWith(`${id}/${role}/`)) {
      throw new Error(`${context}: package ref "${ref}" must be shared or owned by agents.${role}`)
    }
    if (virtualAgentRoles.has(role)) return
    if (!declaredByAgent.get(role)?.has(ref)) {
      throw new Error(`${context}: package ref "${ref}" is not declared in agents.${role}`)
    }
  }

  function assertAgentOwnershipDeclaration(ref: string, id: string, role: AgentRoleID, context: string) {
    if (isSharedPackageRef(ref, id)) return
    if (!ref.startsWith(`${id}/${role}/`)) {
      throw new Error(`${context}: package ref "${ref}" must be shared or owned by agents.${role}`)
    }
  }

  function packageMcpServerRefFromTypedRef(ref: string, kind: "tool" | "prompt" | "resource", context: string) {
    const marker = `/${kind}/`
    const index = ref.lastIndexOf(marker)
    if (index < 0) throw new Error(`${context}: invalid package MCP ${kind} ref "${ref}"`)
    return ref.slice(0, index)
  }

  function assertProjectedPackageMcpTypedRef(input: {
    ref: string
    kind: "tool" | "prompt" | "resource"
    id: string
    available: Set<string>
    declaredByAgent: Map<AgentRoleID, Set<string>>
    virtualAgentRoles: ReadonlySet<AgentRoleID>
    role: AgentRoleID
    context: string
  }) {
    const { ref, kind, id, available, declaredByAgent, virtualAgentRoles, role, context } = input
    assertPackageRef(ref, id, available, context)
    const serverRef = packageMcpServerRefFromTypedRef(ref, kind, context)
    if (isSharedPackageRef(serverRef, id)) return
    if (!serverRef.startsWith(`${id}/${role}/`)) {
      throw new Error(`${context}: package MCP ${kind} ref "${ref}" must be shared or owned by agents.${role}`)
    }
    if (virtualAgentRoles.has(role)) return
    if (!declaredByAgent.get(role)?.has(serverRef)) {
      throw new Error(`${context}: package MCP ${kind} ref "${ref}" server is not declared in agents.${role}`)
    }
  }

  type LoadPackageOptions = {
    workflowBindings?: readonly SchedulerAgentWorkflowBinding[]
  }

  async function workflowToolToRole(
    bindings?: readonly SchedulerAgentWorkflowBinding[],
  ): Promise<Map<OrchestratorWorkflowToolName, AgentRoleID>> {
    const { WorkflowRegistry } = await import("@/engine/workflow")
    const result = new Map<OrchestratorWorkflowToolName, AgentRoleID>()
    for (const binding of bindings ?? WorkflowRegistry.schedulerAgentWorkflowBindingsSync()) {
      result.set(binding.workflow_tool_name, binding.stage)
    }
    return result
  }

  function validateProjection(input: {
    id: string
    context: string
    projection: Projection
    role: AgentRoleID
    refs: Awaited<ReturnType<typeof collectPackageRefs>>
    declaredRefs: DeclaredPackageRefs
    canonicalToolIDs: Set<string>
  }) {
    const { id, context, projection, role, refs, declaredRefs, canonicalToolIDs } = input
    for (const toolID of projection.built_in_tool_ids) {
      if (!canonicalToolIDs.has(toolID)) throw new Error(`${context}: unknown built-in tool "${toolID}"`)
    }
    for (const ref of projection.default_skill_refs) assertDefaultRef(ref, "skill", context)
    for (const ref of projection.default_tool_refs) assertDefaultRef(ref, "tool", context)
    for (const ref of projection.default_mcp_server_refs) assertDefaultRef(ref, "mcp", context)
    for (const ref of projection.default_mcp_tool_refs) {
      if (!/^default\/mcp\/[^/\\]+\/tool\/[^/\\]+$/.test(ref)) {
        throw new Error(`${context}: invalid default MCP tool ref "${ref}"`)
      }
    }
    for (const ref of projection.default_mcp_prompt_refs) {
      if (!/^default\/mcp\/[^/\\]+\/prompt\/[^/\\]+$/.test(ref)) {
        throw new Error(`${context}: invalid default MCP prompt ref "${ref}"`)
      }
    }
    for (const ref of projection.default_mcp_resource_refs) {
      if (!/^default\/mcp\/[^/\\]+\/resource\/[^/\\]+$/.test(ref)) {
        throw new Error(`${context}: invalid default MCP resource ref "${ref}"`)
      }
    }
    for (const ref of projection.package_skill_refs) {
      assertProjectedPackageRef({
        ref,
        id,
        available: refs.skillRefs,
        declaredByAgent: declaredRefs.skillRefs,
        virtualAgentRoles: declaredRefs.virtualAgentRoles,
        role,
        context,
      })
    }
    for (const ref of projection.package_tool_refs) {
      assertProjectedPackageRef({
        ref,
        id,
        available: refs.toolRefs,
        declaredByAgent: declaredRefs.toolRefs,
        virtualAgentRoles: declaredRefs.virtualAgentRoles,
        role,
        context,
      })
    }
    for (const ref of projection.package_mcp_server_refs) {
      assertProjectedPackageRef({
        ref,
        id,
        available: refs.mcpServerRefs,
        declaredByAgent: declaredRefs.mcpServerRefs,
        virtualAgentRoles: declaredRefs.virtualAgentRoles,
        role,
        context,
      })
    }
    for (const ref of projection.package_mcp_tool_refs) {
      assertProjectedPackageMcpTypedRef({
        ref,
        kind: "tool",
        id,
        available: refs.mcpToolRefs,
        declaredByAgent: declaredRefs.mcpServerRefs,
        virtualAgentRoles: declaredRefs.virtualAgentRoles,
        role,
        context,
      })
    }
    for (const ref of projection.package_mcp_prompt_refs) {
      assertProjectedPackageMcpTypedRef({
        ref,
        kind: "prompt",
        id,
        available: refs.mcpPromptRefs,
        declaredByAgent: declaredRefs.mcpServerRefs,
        virtualAgentRoles: declaredRefs.virtualAgentRoles,
        role,
        context,
      })
    }
    for (const ref of projection.package_mcp_resource_refs) {
      assertProjectedPackageMcpTypedRef({
        ref,
        kind: "resource",
        id,
        available: refs.mcpResourceRefs,
        declaredByAgent: declaredRefs.mcpServerRefs,
        virtualAgentRoles: declaredRefs.virtualAgentRoles,
        role,
        context,
      })
    }
  }

  async function readPackageMetadata(root: string, options: { canonicalFolder: boolean }): Promise<ParsedPackageMetadata> {
    const normalizedRoot = Filesystem.normalizePath(root)
    await validatePackageRoot(normalizedRoot)
    await validatePackageTree(normalizedRoot)
    const manifestPath = path.join(normalizedRoot, MANIFEST)
    const rawManifest = await readJsoncFile(manifestPath)
    const manifest = Manifest.parse(rawManifest)

    const folderID = path.basename(normalizedRoot)
    if (options.canonicalFolder && manifest.id !== folderID) {
      throw new Error(`expert squad id "${manifest.id}" must match folder "${folderID}"`)
    }

    const readmePath = await assertFile(normalizedRoot, manifest.readme, "readme")
    const readme = parseReadmeText(await Filesystem.readText(readmePath), "readme")
    return {
      id: manifest.id,
      root: normalizedRoot,
      manifestPath,
      readmePath,
      readmeContent: readme.content,
      displayPrefix: readme.displayPrefix,
      label: manifest.label,
      description: manifest.description,
      version: manifest.version,
      manifest,
      selector: selectorMetadata(manifest),
    }
  }

  async function readCatalogSelectorInstructions(metadata: ParsedPackageMetadata): Promise<string | undefined> {
    const instructions = metadata.manifest.selector?.instructions
    if (!instructions) return undefined
    assertSelectorInstructionsPath(instructions, "selector.instructions")
    const selectorPath = await assertNonBlankFile(metadata.root, instructions, "selector.instructions")
    return (await Filesystem.readText(selectorPath)).trim()
  }

  async function publicMetadata(metadata: ParsedPackageMetadata): Promise<PackageCatalogEntry> {
    return {
      id: metadata.id,
      label: metadata.label,
      description: metadata.description,
      version: metadata.version,
      displayPrefix: metadata.displayPrefix,
      selector: metadata.selector,
      selectorInstructions: await readCatalogSelectorInstructions(metadata),
    }
  }

  function selectorMetadata(manifest: Manifest): SelectorMetadata | undefined {
    return manifest.selector
      ? {
          ref: `selector/${manifest.id}`,
          id: manifest.id,
          label: manifest.label,
          description: manifest.description,
          summary: manifest.selector.summary,
          selection_guidance: manifest.selector.selection_guidance,
        }
      : undefined
  }

  export function loadEmbeddedPackage(source: EmbeddedPackageSource): EmbeddedPackage {
    const manifest = parseManifestText(source.manifestText, `built-in expert squad ${source.id}/${MANIFEST}`)
    if (manifest.id !== source.id) {
      throw new Error(`built-in expert squad source id "${source.id}" does not match manifest id "${manifest.id}"`)
    }
    const readmeContent = source.files[manifest.readme]
    if (typeof readmeContent !== "string") {
      throw new Error(`built-in expert squad ${manifest.id}: missing ${manifest.readme}`)
    }
    const readme = parseReadmeText(readmeContent, `built-in expert squad ${manifest.id} ${manifest.readme}`)

    let selectorInstructions: string | undefined
    if (manifest.selector?.instructions) {
      assertSelectorInstructionsPath(manifest.selector.instructions, `built-in expert squad ${manifest.id}.selector.instructions`)
      const instructions = source.files[manifest.selector.instructions]
      if (typeof instructions !== "string") {
        throw new Error(`built-in expert squad ${manifest.id}: missing selector instructions ${manifest.selector.instructions}`)
      }
      selectorInstructions = instructions.trim()
      if (!selectorInstructions) {
        throw new Error(`built-in expert squad ${manifest.id}: blank selector instructions ${manifest.selector.instructions}`)
      }
    }

    const agents: Record<string, string> = {}
    for (const [agentID, agent] of Object.entries(manifest.agents)) {
      assertRoleID(agentID, `built-in expert squad ${manifest.id}.agents.${agentID}`)
      if (!agent.prompt) continue
      assertSafeManifestRelativePath(agent.prompt, `built-in expert squad ${manifest.id}.agents.${agentID}.prompt`)
      const prompt = source.files[agent.prompt]
      if (typeof prompt !== "string") {
        throw new Error(`built-in expert squad ${manifest.id}: missing prompt file ${agent.prompt}`)
      }
      const trimmed = prompt.trim()
      if (!trimmed) throw new Error(`built-in expert squad ${manifest.id}: blank prompt file ${agent.prompt}`)
      agents[agentID] = trimmed
    }
    const virtualAgents: EmbeddedPackage["promptProfile"]["virtualAgents"] = {}
    const virtualAgentIDs = new Map<string, AgentRoleID>()
    for (const [role, virtualAgent] of Object.entries(manifest.virtual_agents)) {
      assertRoleID(role, `built-in expert squad ${manifest.id}.virtual_agents.${role}`)
      if (Object.hasOwn(manifest.agents, role)) {
        throw new Error(`built-in expert squad ${manifest.id}.virtual_agents.${role}: agents.${role} must be absent when a virtual agent is declared`)
      }
      if (virtualAgent.prompt !== virtualAgentPromptPath(role)) {
        throw new Error(`built-in expert squad ${manifest.id}.virtual_agents.${role}.prompt must be ${virtualAgentPromptPath(role)}`)
      }
      const previousRole = virtualAgentIDs.get(virtualAgent.id)
      if (previousRole) {
        throw new Error(
          `built-in expert squad ${manifest.id}.virtual_agents.${role}.id duplicates virtual_agents.${previousRole}.id "${virtualAgent.id}"`,
        )
      }
      virtualAgentIDs.set(virtualAgent.id, role)
      const prompt = source.files[virtualAgent.prompt]
      if (typeof prompt !== "string") {
        throw new Error(`built-in expert squad ${manifest.id}: missing virtual agent prompt file ${virtualAgent.prompt}`)
      }
      const trimmed = prompt.trim()
      if (!trimmed) throw new Error(`built-in expert squad ${manifest.id}: blank virtual agent prompt file ${virtualAgent.prompt}`)
      virtualAgents[role] = {
        ...virtualAgent,
        promptContent: trimmed,
      }
    }

    return {
      id: manifest.id,
      label: manifest.label,
      description: manifest.description,
      version: manifest.version,
      displayPrefix: readme.displayPrefix,
      selector: selectorMetadata(manifest),
      manifest,
      readmeContent: readme.content,
      selectorInstructions,
      promptProfile: {
        label: manifest.label,
        description: manifest.description,
        agents,
        virtualAgents,
      },
    }
  }

  type SelectorSkillPackage = Pick<
    EmbeddedPackage | LoadedPackage | PackageCatalogEntry,
    "id" | "label" | "description" | "selector"
  > & {
    selectorInstructions?: string
  }

  export function renderSelectorSkillMarkdown(pkg: SelectorSkillPackage): string | undefined {
    if (!pkg.selector) return undefined
    const skillName = `${pkg.id}-expert-squad`
    const description = `Orchestrator skill for ${pkg.label} tasks. ${pkg.selector.summary}`
    if (!pkg.selectorInstructions) {
      throw new Error(`Expert squad ${pkg.id} selector requires top-level selector.md instructions.`)
    }

    return [
      "---",
      `name: ${JSON.stringify(skillName)}`,
      `description: ${JSON.stringify(description)}`,
      "agents:",
      "  - orchestrator",
      "mounted_agents:",
      "  - orchestrator",
      "required_tools:",
      "  - select_expert_squad",
      "priority: 90",
      "---",
      "",
      pkg.selectorInstructions.trim(),
      "",
    ].join("\n")
  }

  function collectDeclaredRefs(manifest: Manifest, refs: Awaited<ReturnType<typeof collectPackageRefs>>): DeclaredPackageRefs {
    const declared: DeclaredPackageRefs = {
      skillRefs: new Map(),
      toolRefs: new Map(),
      mcpServerRefs: new Map(),
      virtualAgentRoles: new Set(),
    }
    const virtualAgentIDs = new Map<string, AgentRoleID>()
    for (const [role, virtualAgent] of Object.entries(manifest.virtual_agents)) {
      assertRoleID(role, `virtual_agents.${role}`)
      if (Object.hasOwn(manifest.agents, role)) {
        throw new Error(`virtual_agents.${role}: agents.${role} must be absent when a virtual agent is declared`)
      }
      if (virtualAgent.prompt !== virtualAgentPromptPath(role)) {
        throw new Error(`virtual_agents.${role}.prompt must be ${virtualAgentPromptPath(role)}`)
      }
      const previousRole = virtualAgentIDs.get(virtualAgent.id)
      if (previousRole) {
        throw new Error(`virtual_agents.${role}.id duplicates virtual_agents.${previousRole}.id "${virtualAgent.id}"`)
      }
      virtualAgentIDs.set(virtualAgent.id, role)
      declared.virtualAgentRoles.add(role)
    }
    for (const [agentID, agent] of Object.entries(manifest.agents)) {
      assertRoleID(agentID, `agents.${agentID}`)
      for (const ref of agent.skill_refs) {
        assertPackageRef(ref, manifest.id, refs.skillRefs, `agents.${agentID}.skill_refs`)
        assertAgentOwnershipDeclaration(ref, manifest.id, agentID, `agents.${agentID}.skill_refs`)
      }
      for (const ref of agent.tool_refs) {
        assertPackageRef(ref, manifest.id, refs.toolRefs, `agents.${agentID}.tool_refs`)
        assertAgentOwnershipDeclaration(ref, manifest.id, agentID, `agents.${agentID}.tool_refs`)
      }
      for (const ref of agent.mcp_server_refs) {
        assertPackageRef(ref, manifest.id, refs.mcpServerRefs, `agents.${agentID}.mcp_server_refs`)
        assertAgentOwnershipDeclaration(ref, manifest.id, agentID, `agents.${agentID}.mcp_server_refs`)
      }
      declared.skillRefs.set(agentID, new Set(agent.skill_refs))
      declared.toolRefs.set(agentID, new Set(agent.tool_refs))
      declared.mcpServerRefs.set(agentID, new Set(agent.mcp_server_refs))
    }
    return declared
  }

  async function validateVirtualAgentFiles(metadata: ParsedPackageMetadata) {
    const declaredRoles = new Set(Object.keys(metadata.manifest.virtual_agents))
    const virtualRoot = path.join(metadata.root, "virtual-agents")
    for (const entry of await readOptionalDirectoryEntries(virtualRoot, "virtual-agents")) {
      if (!entry.isDirectory()) throw new Error(`virtual-agents.${entry.name}: expected directory`)
      assertRoleID(entry.name, `virtual-agents.${entry.name}`)
      if (!declaredRoles.has(entry.name)) {
        throw new Error(`virtual-agents.${entry.name}: directory must be declared in virtual_agents.${entry.name}`)
      }
    }
    for (const [role, virtualAgent] of Object.entries(metadata.manifest.virtual_agents)) {
      assertRoleID(role, `virtual_agents.${role}`)
      if (virtualAgent.prompt !== virtualAgentPromptPath(role)) {
        throw new Error(`virtual_agents.${role}.prompt must be ${virtualAgentPromptPath(role)}`)
      }
      const roleOverlayPrompt = path.join(metadata.root, "agents", role, "system.md")
      const roleOverlayInfo = await lstat(roleOverlayPrompt).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined
        throw error
      })
      if (roleOverlayInfo) {
        throw new Error(`virtual_agents.${role}: agents/${role}/system.md must be absent when a virtual agent is declared`)
      }
      await assertNonBlankFile(metadata.root, virtualAgent.prompt, `virtual_agents.${role}.prompt`)
    }
  }

  async function readPromptProfile(metadata: ParsedPackageMetadata): Promise<LoadedPackage["promptProfile"]> {
    const agents: Record<string, string> = {}
    for (const [agentID, agent] of Object.entries(metadata.manifest.agents)) {
      assertRoleID(agentID, `agents.${agentID}`)
      if (!agent.prompt) continue
      const file = await assertNonBlankFile(metadata.root, agent.prompt, `agents.${agentID}.prompt`)
      agents[agentID] = (await Filesystem.readText(file)).trim()
    }
    const virtualAgents: LoadedPackage["promptProfile"]["virtualAgents"] = {}
    for (const [role, virtualAgent] of Object.entries(metadata.manifest.virtual_agents)) {
      assertRoleID(role, `virtual_agents.${role}`)
      const file = await assertNonBlankFile(metadata.root, virtualAgent.prompt, `virtual_agents.${role}.prompt`)
      virtualAgents[role] = {
        ...virtualAgent,
        promptContent: (await Filesystem.readText(file)).trim(),
      }
    }
    return {
      label: metadata.label,
      description: metadata.description,
      agents,
      virtualAgents,
    }
  }

  async function loadValidatedPackage(
    root: string,
    options: { canonicalFolder: boolean } & LoadPackageOptions,
  ): Promise<LoadedPackage> {
    const metadata = await readPackageMetadata(root, options)
    const { manifest } = metadata

    for (const [agentID, agent] of Object.entries(manifest.agents)) {
      assertRoleID(agentID, `agents.${agentID}`)
      if (agent.prompt) await assertFile(metadata.root, agent.prompt, `agents.${agentID}.prompt`)
    }
    for (const role of Object.keys(manifest.virtual_agents)) {
      if (Object.hasOwn(manifest.agents, role)) {
        throw new Error(`virtual_agents.${role}: agents.${role} must be absent when a virtual agent is declared`)
      }
    }
    await validateVirtualAgentFiles(metadata)
    const selectorInstructions = await readCatalogSelectorInstructions(metadata)

    const refs = await collectPackageRefs(metadata.root, manifest.id)
    const declaredRefs = collectDeclaredRefs(manifest, refs)

    const [{ AgentToolPool }, workflowByTool] = await Promise.all([
      import("@/agent/tool-pool-contract"),
      workflowToolToRole(options.workflowBindings),
    ])
    const canonicalToolIDs = AgentToolPool.canonicalToolIDs()
    validateProjection({
      id: manifest.id,
      context: "capability_projection.scheduler",
      projection: manifest.capability_projection.scheduler,
      role: "orchestrator",
      refs,
      declaredRefs,
      canonicalToolIDs,
    })
    for (const [agentID, projection] of Object.entries(manifest.capability_projection.agents)) {
      assertRoleID(agentID, `capability_projection.agents.${agentID}`)
      validateProjection({
        id: manifest.id,
        context: `capability_projection.agents.${agentID}`,
        projection,
        role: agentID,
        refs,
        declaredRefs,
        canonicalToolIDs,
      })
    }
    for (const role of Object.keys(manifest.virtual_agents)) {
      assertRoleID(role, `virtual_agents.${role}`)
      if (!manifest.capability_projection.agents[role]) {
        throw new Error(`virtual_agents.${role} requires capability_projection.agents.${role}`)
      }
    }

    const explicitSchedulerWorkflowTools = manifest.capability_projection.scheduler.built_in_tool_ids.filter(
      (toolID): toolID is OrchestratorWorkflowToolName => workflowByTool.has(toolID as OrchestratorWorkflowToolName),
    )
    for (const workflowTool of explicitSchedulerWorkflowTools) {
      const role = workflowByTool.get(workflowTool)!
      if (!manifest.capability_projection.agents[role]) {
        throw new Error(`capability_projection.scheduler.${workflowTool} requires capability_projection.agents.${role}`)
      }
    }

    const promptProfile = await readPromptProfile(metadata)
    return {
      ...metadata,
      id: manifest.id,
      manifest,
      selectorInstructions,
      promptProfile,
      packageSkillRefs: refs.skillRefs,
      packageToolRefs: refs.toolRefs,
      packageMcpServerRefs: refs.mcpServerRefs,
      packageMcpToolRefs: refs.mcpToolRefs,
      packageMcpPromptRefs: refs.mcpPromptRefs,
      packageMcpResourceRefs: refs.mcpResourceRefs,
      explicitSchedulerWorkflowTools,
    }
  }

  export async function loadPackage(root: string, options: LoadPackageOptions = {}): Promise<LoadedPackage> {
    return loadValidatedPackage(root, { canonicalFolder: true, ...options })
  }

  export async function loadSourcePackage(root: string, options: LoadPackageOptions = {}): Promise<LoadedPackage> {
    return loadValidatedPackage(root, { canonicalFolder: false, ...options })
  }

  export async function loadCatalogPackage(root: string): Promise<CatalogPackage> {
    return loadValidatedPackage(root, { canonicalFolder: true })
  }

  export async function discover(root: string): Promise<PackageCatalogEntry[]> {
    const base = path.join(root, ".opencorvus", DIRECTORY)
    const packages: PackageCatalogEntry[] = []
    const seen = new Set<string>()
    for (const entry of await readOptionalDirectoryEntries(base, ".opencorvus/expert-squads")) {
      if (!entry.isDirectory()) throw new Error(`.opencorvus/expert-squads.${entry.name}: expected directory`)
      const packageRoot = path.join(base, entry.name)
      const pkg = await readPackageMetadata(packageRoot, { canonicalFolder: true })
      if (seen.has(pkg.id)) throw new Error(`duplicate expert squad id "${pkg.id}"`)
      seen.add(pkg.id)
      packages.push(await publicMetadata(pkg))
    }
    return packages
  }
}
