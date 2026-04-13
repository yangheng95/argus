import { Log } from "../util/log"
import path from "path"
import { pathToFileURL } from "url"
import { createRequire } from "module"
import os from "os"
import z from "zod"
import { ModelsDev } from "../provider/models"
import { mergeDeep, pipe, unique } from "remeda"
import { Global } from "../global"
import fs from "fs/promises"
import { lazy } from "../util/lazy"
import { NamedError } from "@opencorvus-ai/util/error"
import { Flag } from "../flag/flag"
import { Auth } from "../auth"
import {
  type ParseError as JsoncParseError,
  applyEdits,
  modify,
  parse as parseJsonc,
  printParseErrorCode,
} from "jsonc-parser"
import { Instance } from "../project/instance"
import { LSPServer } from "../lsp/server"
import { BunProc } from "@/bun"
import { Installation } from "@/installation"
import { ConfigMarkdown } from "./markdown"
import { constants, existsSync } from "fs"
import { Bus } from "@/bus"
import { GlobalBus } from "@/bus/global"
import { Event } from "../server/event"
import { Glob } from "../util/glob"
import { PackageRegistry } from "@/bun/registry"
import { proxied } from "@/util/proxied"
import { iife } from "@/util/iife"
import { ConfigPaths } from "./paths"
import { Filesystem } from "@/util/filesystem"
import { buildChannelSchema } from "@/channel/catalog"

export namespace Config {
  const ModelId = z.string().meta({ $ref: "https://models.dev/model-schema.json#/$defs/Model" })

  const log = Log.create({ service: "config" })

  function errnoCode(error: unknown): string | undefined {
    if (!error || typeof error !== "object") return
    const direct = (error as NodeJS.ErrnoException).code
    if (typeof direct === "string") return direct
    const cause = (error as { cause?: NodeJS.ErrnoException }).cause
    if (!cause) return
    return cause.code
  }

  function permissionDenied(error: unknown) {
    const code = errnoCode(error)
    return code === "EACCES" || code === "EPERM"
  }

  // Managed settings directory for enterprise deployments (highest priority, admin-controlled)
  // These settings override all user and project settings
  function systemManagedConfigDir(): string {
    switch (process.platform) {
      case "darwin":
        return "/Library/Application Support/opencorvus"
      case "win32":
        return path.join(process.env.ProgramData || "C:\\ProgramData", "opencorvus")
      default:
        return "/etc/opencorvus"
    }
  }

  export function managedConfigDir() {
    return process.env.OPENCORVUS_TEST_MANAGED_CONFIG_DIR || systemManagedConfigDir()
  }

  const managedDir = managedConfigDir()

  // Custom merge function that concatenates array fields instead of replacing them
  function mergeConfigConcatArrays(target: Info, source: Info): Info {
    const merged = mergeDeep(target, source)
    if (target.plugin && source.plugin) {
      merged.plugin = Array.from(new Set([...target.plugin, ...source.plugin]))
    }
    if (target.instructions && source.instructions) {
      merged.instructions = Array.from(new Set([...target.instructions, ...source.instructions]))
    }
    return merged
  }

  export const state = Instance.state(async () => {
    const auth = await Auth.all()

    // Config loading order (low -> high precedence): https://opencorvus.ai/docs/config#precedence-order
    // 1) Remote .well-known/opencorvus (org defaults)
    // 2) Global config (~/.config/opencorvus/opencorvus.json{,c})
    // 3) Custom config (OPENCORVUS_CONFIG)
    // 4) Project config (opencorvus.json{,c})
    // 5) local config directories (.opencorvus/*)
    // 6) Inline config (OPENCORVUS_CONFIG_CONTENT)
    // Managed config directory is enterprise-only and always overrides everything above.
    let result: Info = {}
    for (const [key, value] of Object.entries(auth)) {
      if (value.type === "wellknown") {
        process.env[value.key] = value.token
        log.debug("fetching remote config", { url: `${key}/.well-known/opencorvus` })
        const response = await fetch(`${key}/.well-known/opencorvus`)
        if (!response.ok) {
          throw new Error(`failed to fetch remote config from ${key}: ${response.status}`)
        }
        const wellknown = (await response.json()) as any
        const remoteConfig = wellknown.config ?? {}
        // Add $schema to prevent load() from trying to write back to a non-existent file
        if (!remoteConfig.$schema) remoteConfig.$schema = "https://opencorvus.ai/config.json"
        result = mergeConfigConcatArrays(
          result,
          await load(JSON.stringify(remoteConfig), {
            dir: path.dirname(`${key}/.well-known/opencorvus`),
            source: `${key}/.well-known/opencorvus`,
          }),
        )
        log.debug("loaded remote config from well-known", { url: key })
      }
    }

    // Global user config overrides remote config.
    result = mergeConfigConcatArrays(result, await global())

    // Custom config path overrides global config.
    if (Flag.OPENCORVUS_CONFIG) {
      result = mergeConfigConcatArrays(result, await loadFile(Flag.OPENCORVUS_CONFIG))
      log.debug("loaded custom config", { path: Flag.OPENCORVUS_CONFIG })
    }

    // Project config overrides global and remote config.
    if (!Flag.OPENCORVUS_DISABLE_PROJECT_CONFIG) {
      for (const file of await ConfigPaths.projectFiles("opencorvus", Instance.directory, Instance.worktree)) {
        result = mergeConfigConcatArrays(result, await loadFile(file))
      }
    }

    result.agent = result.agent || {}
    result.plugin = result.plugin || []

    const directories = await ConfigPaths.directories(Instance.directory, Instance.worktree)

    // .opencorvus directory config overrides (project and global) config sources.
    if (Flag.OPENCORVUS_CONFIG_DIR) {
      log.debug("loading config from OPENCORVUS_CONFIG_DIR", { path: Flag.OPENCORVUS_CONFIG_DIR })
    }

    const deps: Promise<void>[] = []

    for (const dir of unique(directories)) {
      if (dir.endsWith(".opencorvus") || dir === Flag.OPENCORVUS_CONFIG_DIR) {
        for (const file of ["opencorvus.jsonc", "opencorvus.json"]) {
          log.debug(`loading config from ${path.join(dir, file)}`)
          result = mergeConfigConcatArrays(result, await loadFile(path.join(dir, file)))
          // to satisfy the type checker
          result.agent ??= {}
          result.plugin ??= []
        }
      }

      deps.push(
        iife(async () => {
          const shouldInstall = await needsInstall(dir)
          if (shouldInstall) await installDependencies(dir)
        }),
      )

      result.command = mergeDeep(result.command ?? {}, await loadCommand(dir))
      result.agent = mergeDeep(result.agent, await loadAgent(dir))
      result.agent = mergeDeep(result.agent, await loadMode(dir))
      result.plugin.push(...(await loadPlugin(dir)))
    }

    // Inline config content overrides all non-managed config sources.
    if (process.env.OPENCORVUS_CONFIG_CONTENT) {
      result = mergeConfigConcatArrays(
        result,
        await load(process.env.OPENCORVUS_CONFIG_CONTENT, {
          dir: Instance.directory,
          source: "OPENCORVUS_CONFIG_CONTENT",
        }),
      )
      log.debug("loaded custom config from OPENCORVUS_CONFIG_CONTENT")
    }

    // Load managed config files last (highest priority) - enterprise admin-controlled
    // Kept separate from directories array to avoid write operations when installing plugins
    // which would fail on system directories requiring elevated permissions
    // This way it only loads config file and not skills/plugins/commands
    try {
      if (existsSync(managedDir)) {
        for (const file of ["opencorvus.jsonc", "opencorvus.json"]) {
          const managedFile = path.join(managedDir, file)
          try {
            result = mergeConfigConcatArrays(result, await loadFile(managedFile))
          } catch (error) {
            if (!permissionDenied(error)) throw error
            log.warn("skipping managed config due to permission error", { path: managedFile })
          }
        }
      }
    } catch (error) {
      if (!permissionDenied(error)) throw error
      log.warn("managed config directory exists but cannot be accessed", { path: managedDir })
    }

    if (Flag.OPENCORVUS_PERMISSION) {
      result.permission = mergeDeep(
        (result.permission ?? {}) as object,
        JSON.parse(Flag.OPENCORVUS_PERMISSION),
      ) as Config.Permission
    }

    if (!result.username) result.username = os.userInfo().username

    // Apply flag overrides for compaction settings
    if (Flag.OPENCORVUS_DISABLE_AUTOCOMPACT) {
      result.compaction = { ...result.compaction, auto: false }
    }
    if (Flag.OPENCORVUS_DISABLE_PRUNE) {
      result.compaction = { ...result.compaction, prune: false }
    }

    result.plugin = deduplicatePlugins(result.plugin ?? [])

    // Write resolved config to project directory on first load if no project config exists yet.
    if (!Flag.OPENCORVUS_DISABLE_PROJECT_CONFIG && Instance.directory) {
      const configFile = projectConfigFile()
      if (!existsSync(configFile)) {
        try {
          await fs.mkdir(projectConfigDirectory(), { recursive: true })
          await Filesystem.writeJson(configFile, result)
          log.info("wrote default config to project directory", { path: configFile })
        } catch (error) {
          log.warn("failed to write default config to project directory", { path: configFile, error: String(error) })
        }
      }
    }

    return {
      config: result,
      directories,
      deps,
    }
  })

  export async function waitForDependencies() {
    const deps = await state().then((x) => x.deps)
    await Promise.all(deps)
  }

  export async function installDependencies(dir: string) {
    // Skip plugin installation when plugins are disabled (e.g. benchmark, CI).
    // The @opencorvus-ai/plugin package is only used for type definitions and
    // fetching it requires a private registry that may be unreachable.
    if (process.env.OPENCORVUS_DISABLE_DEFAULT_PLUGINS === "1") {
      log.debug("plugins disabled, skipping dependency install", { dir })
      return
    }

    const pkg = path.join(dir, "package.json")
    const targetVersion = Installation.isLocal() ? "*" : Installation.VERSION

    const json = await Filesystem.readJson<{ dependencies?: Record<string, string> }>(pkg).catch(() => ({
      dependencies: {},
    }))
    json.dependencies = {
      ...json.dependencies,
      "@opencorvus-ai/plugin": targetVersion,
    }
    await Filesystem.writeJson(pkg, json)

    const gitignore = path.join(dir, ".gitignore")
    const hasGitIgnore = await Filesystem.exists(gitignore)
    if (!hasGitIgnore)
      await Filesystem.write(gitignore, ["node_modules", "package.json", "bun.lock", ".gitignore"].join("\n"))

    // Install any additional dependencies defined in the package.json
    // This allows local plugins and custom tools to use external packages
    await BunProc.run(
      [
        "install",
        // TODO: get rid of this case (see: https://github.com/oven-sh/bun/issues/19936)
        ...(proxied() || process.env.CI ? ["--no-cache"] : []),
      ],
      { cwd: dir },
    ).catch((err) => {
      log.warn("failed to install dependencies", { dir, error: err })
    })
  }

  async function isWritable(dir: string) {
    try {
      await fs.access(dir, constants.W_OK)
      return true
    } catch {
      return false
    }
  }

  export async function needsInstall(dir: string) {
    if (process.env.OPENCORVUS_DISABLE_DEFAULT_PLUGINS === "1") return false

    // Some config dirs may be read-only.
    // Installing deps there will fail; skip installation in that case.
    const writable = await isWritable(dir)
    if (!writable) {
      log.debug("config dir is not writable, skipping dependency install", { dir })
      return false
    }

    const nodeModules = path.join(dir, "node_modules")
    if (!existsSync(nodeModules)) return true

    const pkg = path.join(dir, "package.json")
    const pkgExists = await Filesystem.exists(pkg)
    if (!pkgExists) return true

    const parsed = await Filesystem.readJson<{ dependencies?: Record<string, string> }>(pkg).catch(() => null)
    const dependencies = parsed?.dependencies ?? {}
    const depVersion = dependencies["@opencorvus-ai/plugin"]
    if (!depVersion) return true

    const targetVersion = Installation.isLocal() ? "latest" : Installation.VERSION
    if (targetVersion === "latest") {
      const isOutdated = await PackageRegistry.isOutdated("@opencorvus-ai/plugin", depVersion, dir)
      if (!isOutdated) return false
      log.info("Cached version is outdated, proceeding with install", {
        pkg: "@opencorvus-ai/plugin",
        cachedVersion: depVersion,
      })
      return true
    }
    if (depVersion === targetVersion) return false
    return true
  }

  function rel(item: string, patterns: string[]) {
    const normalizedItem = item.replaceAll("\\", "/")
    for (const pattern of patterns) {
      const index = normalizedItem.indexOf(pattern)
      if (index === -1) continue
      return normalizedItem.slice(index + pattern.length)
    }
  }

  function trim(file: string) {
    const ext = path.extname(file)
    return ext.length ? file.slice(0, -ext.length) : file
  }

  async function loadCommand(dir: string) {
    const result: Record<string, Command> = {}
    for (const item of await Glob.scan("{command,commands}/**/*.md", {
      cwd: dir,
      absolute: true,
      dot: true,
      symlink: true,
    })) {
      const md = await ConfigMarkdown.parse(item).catch(async (err) => {
        const message = ConfigMarkdown.FrontmatterError.isInstance(err)
          ? err.data.message
          : `Failed to parse command ${item}`
        const { Session } = await import("@/session")
        Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        log.error("failed to load command", { command: item, err })
        return undefined
      })
      if (!md) continue

      const patterns = ["/.opencorvus/command/", "/.opencorvus/commands/", "/command/", "/commands/"]
      const file = rel(item, patterns) ?? path.basename(item)
      const name = trim(file)

      const config = {
        name,
        ...md.data,
        template: md.content.trim(),
      }
      const parsed = Command.safeParse(config)
      if (parsed.success) {
        result[config.name] = parsed.data
        continue
      }
      throw new InvalidError({ path: item, issues: parsed.error.issues }, { cause: parsed.error })
    }
    return result
  }

  async function loadAgent(dir: string) {
    const result: Record<string, Agent> = {}

    for (const item of await Glob.scan("{agent,agents}/**/*.md", {
      cwd: dir,
      absolute: true,
      dot: true,
      symlink: true,
    })) {
      const md = await ConfigMarkdown.parse(item).catch(async (err) => {
        const message = ConfigMarkdown.FrontmatterError.isInstance(err)
          ? err.data.message
          : `Failed to parse agent ${item}`
        const { Session } = await import("@/session")
        Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        log.error("failed to load agent", { agent: item, err })
        return undefined
      })
      if (!md) continue

      const patterns = ["/.opencorvus/agent/", "/.opencorvus/agents/", "/agent/", "/agents/"]
      const file = rel(item, patterns) ?? path.basename(item)
      const agentName = trim(file)

      const config = {
        name: agentName,
        ...md.data,
        prompt: md.content.trim(),
      }
      const parsed = Agent.safeParse(config)
      if (parsed.success) {
        result[config.name] = parsed.data
        continue
      }
      throw new InvalidError({ path: item, issues: parsed.error.issues }, { cause: parsed.error })
    }
    return result
  }

  async function loadMode(dir: string) {
    const result: Record<string, Agent> = {}
    for (const item of await Glob.scan("{mode,modes}/*.md", {
      cwd: dir,
      absolute: true,
      dot: true,
      symlink: true,
    })) {
      const md = await ConfigMarkdown.parse(item).catch(async (err) => {
        const message = ConfigMarkdown.FrontmatterError.isInstance(err)
          ? err.data.message
          : `Failed to parse mode ${item}`
        const { Session } = await import("@/session")
        Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        log.error("failed to load mode", { mode: item, err })
        return undefined
      })
      if (!md) continue

      const config = {
        name: path.basename(item, ".md"),
        ...md.data,
        prompt: md.content.trim(),
      }
      const parsed = Agent.safeParse(config)
      if (parsed.success) {
        result[config.name] = {
          ...parsed.data,
          mode: "primary" as const,
        }
        continue
      }
    }
    return result
  }

  async function loadPlugin(dir: string) {
    const plugins: string[] = []

    for (const item of await Glob.scan("{plugin,plugins}/*.{ts,js}", {
      cwd: dir,
      absolute: true,
      dot: true,
      symlink: true,
    })) {
      plugins.push(pathToFileURL(item).href)
    }
    return plugins
  }

  /**
   * Extracts a canonical plugin name from a plugin specifier.
   * - For file:// URLs: extracts filename without extension
   * - For npm packages: extracts package name without version
   *
   * @example
   * getPluginName("file:///path/to/plugin/foo.js") // "foo"
   * getPluginName("oh-my-opencorvus@2.4.3") // "oh-my-opencorvus"
   * getPluginName("@scope/pkg@1.0.0") // "@scope/pkg"
   */
  export function getPluginName(plugin: string): string {
    if (plugin.startsWith("file://")) {
      return path.parse(new URL(plugin).pathname).name
    }
    const lastAt = plugin.lastIndexOf("@")
    if (lastAt > 0) {
      return plugin.substring(0, lastAt)
    }
    return plugin
  }

  /**
   * Deduplicates plugins by name, with later entries (higher priority) winning.
   * Priority order (highest to lowest):
   * 1. Local plugin/ directory
   * 2. Local opencorvus.json
   * 3. Global plugin/ directory
   * 4. Global opencorvus.json
   *
   * Since plugins are added in low-to-high priority order,
   * we reverse, deduplicate (keeping first occurrence), then restore order.
   */
  export function deduplicatePlugins(plugins: string[]): string[] {
    // seenNames: canonical plugin names for duplicate detection
    // e.g., "oh-my-opencorvus", "@scope/pkg"
    const seenNames = new Set<string>()

    // uniqueSpecifiers: full plugin specifiers to return
    // e.g., "oh-my-opencorvus@2.4.3", "file:///path/to/plugin.js"
    const uniqueSpecifiers: string[] = []

    for (const specifier of plugins.toReversed()) {
      const name = getPluginName(specifier)
      if (!seenNames.has(name)) {
        seenNames.add(name)
        uniqueSpecifiers.push(specifier)
      }
    }

    return uniqueSpecifiers.toReversed()
  }

  export const McpLocal = z
    .object({
      type: z.literal("local").describe("Type of MCP server connection"),
      command: z.string().array().describe("Command and arguments to run the MCP server"),
      environment: z
        .record(z.string(), z.string())
        .optional()
        .describe("Environment variables to set when running the MCP server"),
      enabled: z.boolean().optional().describe("Enable or disable the MCP server on startup"),
      timeout: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Timeout in ms for MCP server requests. Defaults to 5000 (5 seconds) if not specified."),
    })
    .strict()
    .meta({
      ref: "McpLocalConfig",
    })

  export const McpOAuth = z
    .object({
      clientId: z
        .string()
        .optional()
        .describe("OAuth client ID. If not provided, dynamic client registration (RFC 7591) will be attempted."),
      clientSecret: z.string().optional().describe("OAuth client secret (if required by the authorization server)"),
      scope: z.string().optional().describe("OAuth scopes to request during authorization"),
    })
    .strict()
    .meta({
      ref: "McpOAuthConfig",
    })
  export type McpOAuth = z.infer<typeof McpOAuth>

  export const McpRemote = z
    .object({
      type: z.literal("remote").describe("Type of MCP server connection"),
      url: z.string().describe("URL of the remote MCP server"),
      enabled: z.boolean().optional().describe("Enable or disable the MCP server on startup"),
      headers: z.record(z.string(), z.string()).optional().describe("Headers to send with the request"),
      oauth: z
        .union([McpOAuth, z.literal(false)])
        .optional()
        .describe(
          "OAuth authentication configuration for the MCP server. Set to false to disable OAuth auto-detection.",
        ),
      timeout: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Timeout in ms for MCP server requests. Defaults to 5000 (5 seconds) if not specified."),
    })
    .strict()
    .meta({
      ref: "McpRemoteConfig",
    })

  export const Mcp = z.discriminatedUnion("type", [McpLocal, McpRemote])
  export type Mcp = z.infer<typeof Mcp>

  export const PermissionAction = z.enum(["ask", "allow", "deny"]).meta({
    ref: "PermissionActionConfig",
  })
  export type PermissionAction = z.infer<typeof PermissionAction>

  export const PermissionObject = z.record(z.string(), PermissionAction).meta({
    ref: "PermissionObjectConfig",
  })
  export type PermissionObject = z.infer<typeof PermissionObject>

  export const PermissionRule = z.union([PermissionAction, PermissionObject]).meta({
    ref: "PermissionRuleConfig",
  })
  export type PermissionRule = z.infer<typeof PermissionRule>

  export const Permission = z
    .union([
      z
        .object({
          read: PermissionRule.optional(),
          edit: PermissionRule.optional(),
          glob: PermissionRule.optional(),
          grep: PermissionRule.optional(),
          list: PermissionRule.optional(),
          bash: PermissionRule.optional(),
          task: PermissionRule.optional(),
          external_directory: PermissionRule.optional(),
          todowrite: PermissionAction.optional(),
          todoread: PermissionAction.optional(),
          question: PermissionAction.optional(),
          plan_enter: PermissionAction.optional(),
          plan_exit: PermissionAction.optional(),
          spec_enter: PermissionAction.optional(),
          spec_exit: PermissionAction.optional(),
          webfetch: PermissionAction.optional(),
          websearch: PermissionAction.optional(),
          codesearch: PermissionAction.optional(),
          lsp: PermissionRule.optional(),
          doom_loop: PermissionAction.optional(),
          skill: PermissionRule.optional(),
        })
        .catchall(PermissionRule),
      PermissionAction,
    ])
    .meta({
      ref: "PermissionConfig",
    })
  export type Permission = z.infer<typeof Permission>

  export const Command = z.object({
    template: z.string(),
    description: z.string().optional(),
    agent: z.string().optional(),
    model: ModelId.optional(),
    subtask: z.boolean().optional(),
  })
  export type Command = z.infer<typeof Command>

  export const Skills = z.object({
    paths: z.array(z.string()).optional().describe("Additional paths to skill folders"),
    urls: z
      .array(z.string())
      .optional()
      .describe("URLs to fetch skills from (e.g., https://example.com/.well-known/skills/)"),
  })
  export type Skills = z.infer<typeof Skills>

  export const Agent = z
    .object({
      model: ModelId.optional(),
      variant: z
        .string()
        .optional()
        .describe("Default model variant for this agent (applies only when using the agent's configured model)."),
      temperature: z.number().optional(),
      top_p: z.number().optional(),
      prompt: z.string().optional(),
      disable: z.boolean().optional(),
      description: z.string().optional().describe("Description of when to use the agent"),
      mode: z.enum(["subagent", "primary", "all"]).optional(),
      hidden: z
        .boolean()
        .optional()
        .describe("Hide this subagent from the @ autocomplete menu (default: false, only applies to mode: subagent)"),
      options: z.record(z.string(), z.any()).optional(),
      color: z
        .union([
          z.string().regex(/^#[0-9a-fA-F]{6}$/, "Invalid hex color format"),
          z.enum(["primary", "secondary", "accent", "success", "warning", "error", "info"]),
        ])
        .optional()
        .describe("Hex color code (e.g., #FF5733) or theme color (e.g., primary)"),
      steps: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Maximum number of agentic iterations before forcing text-only response"),
      permission: Permission.optional(),
    })
    .catchall(z.any())
    .transform((agent) => {
      const knownKeys = new Set([
        "name",
        "model",
        "variant",
        "prompt",
        "description",
        "temperature",
        "top_p",
        "mode",
        "hidden",
        "color",
        "steps",
        "options",
        "permission",
        "disable",
      ])

      // Extract unknown properties into options
      const options: Record<string, unknown> = { ...agent.options }
      for (const [key, value] of Object.entries(agent)) {
        if (!knownKeys.has(key)) options[key] = value
      }

      return { ...agent, options } as typeof agent & {
        options?: Record<string, unknown>
        permission?: Permission
        steps?: number
      }
    })
    .meta({
      ref: "AgentConfig",
    })
  export type Agent = z.infer<typeof Agent>

  export const Keybinds = z
    .object({
      leader: z.string().optional().default("ctrl+x").describe("Leader key for keybind combinations"),
      app_exit: z.string().optional().default("ctrl+c,ctrl+d,<leader>q").describe("Exit the application"),
      editor_open: z.string().optional().default("<leader>e").describe("Open external editor"),
      theme_list: z.string().optional().default("<leader>t").describe("List available themes"),
      sidebar_toggle: z.string().optional().default("<leader>b").describe("Toggle sidebar"),
      scrollbar_toggle: z.string().optional().default("none").describe("Toggle session scrollbar"),
      username_toggle: z.string().optional().default("none").describe("Toggle username visibility"),
      status_view: z.string().optional().default("<leader>s").describe("View status"),
      session_export: z.string().optional().default("<leader>x").describe("Export session to editor"),
      session_new: z.string().optional().default("<leader>n").describe("Create a new session"),
      session_list: z.string().optional().default("<leader>l").describe("List all sessions"),
      session_timeline: z.string().optional().default("<leader>g").describe("Show session timeline"),
      session_fork: z.string().optional().default("none").describe("Fork session from message"),
      session_rename: z.string().optional().default("ctrl+r").describe("Rename session"),
      session_delete: z.string().optional().default("ctrl+d").describe("Delete session"),
      stash_delete: z.string().optional().default("ctrl+d").describe("Delete stash entry"),
      model_provider_list: z.string().optional().default("ctrl+a").describe("Open provider list from model dialog"),
      model_favorite_toggle: z.string().optional().default("ctrl+f").describe("Toggle model favorite status"),
      session_share: z.string().optional().default("none").describe("Share current session"),
      session_unshare: z.string().optional().default("none").describe("Unshare current session"),
      session_interrupt: z.string().optional().default("escape").describe("Interrupt current session"),
      session_compact: z.string().optional().default("<leader>c").describe("Compact the session"),
      messages_page_up: z.string().optional().default("pageup,ctrl+alt+b").describe("Scroll messages up by one page"),
      messages_page_down: z
        .string()
        .optional()
        .default("pagedown,ctrl+alt+f")
        .describe("Scroll messages down by one page"),
      messages_line_up: z.string().optional().default("ctrl+alt+y").describe("Scroll messages up by one line"),
      messages_line_down: z.string().optional().default("ctrl+alt+e").describe("Scroll messages down by one line"),
      messages_half_page_up: z.string().optional().default("ctrl+alt+u").describe("Scroll messages up by half page"),
      messages_half_page_down: z
        .string()
        .optional()
        .default("ctrl+alt+d")
        .describe("Scroll messages down by half page"),
      messages_first: z.string().optional().default("ctrl+g,home").describe("Navigate to first message"),
      messages_last: z.string().optional().default("ctrl+alt+g,end").describe("Navigate to last message"),
      messages_next: z.string().optional().default("none").describe("Navigate to next message"),
      messages_previous: z.string().optional().default("none").describe("Navigate to previous message"),
      messages_last_user: z.string().optional().default("none").describe("Navigate to last user message"),
      messages_copy: z.string().optional().default("<leader>y").describe("Copy message"),
      messages_undo: z.string().optional().default("<leader>u").describe("Undo message"),
      messages_redo: z.string().optional().default("<leader>r").describe("Redo message"),
      messages_toggle_conceal: z
        .string()
        .optional()
        .default("<leader>h")
        .describe("Toggle code block concealment in messages"),
      tool_details: z.string().optional().default("none").describe("Toggle tool details visibility"),
      model_list: z.string().optional().default("<leader>m").describe("List available models"),
      model_cycle_recent: z.string().optional().default("f2").describe("Next recently used model"),
      model_cycle_recent_reverse: z.string().optional().default("shift+f2").describe("Previous recently used model"),
      model_cycle_favorite: z.string().optional().default("none").describe("Next favorite model"),
      model_cycle_favorite_reverse: z.string().optional().default("none").describe("Previous favorite model"),
      command_list: z.string().optional().default("ctrl+p").describe("List available commands"),
      agent_list: z.string().optional().default("<leader>a").describe("List agents"),
      agent_cycle: z.string().optional().default("tab").describe("Next agent"),
      agent_cycle_reverse: z.string().optional().default("shift+tab").describe("Previous agent"),
      variant_cycle: z.string().optional().default("ctrl+t").describe("Cycle model variants"),
      input_clear: z.string().optional().default("ctrl+c").describe("Clear input field"),
      input_paste: z.string().optional().default("ctrl+v").describe("Paste from clipboard"),
      input_submit: z.string().optional().default("return").describe("Submit input"),
      input_newline: z
        .string()
        .optional()
        .default("shift+return,ctrl+return,alt+return,ctrl+j")
        .describe("Insert newline in input"),
      input_move_left: z.string().optional().default("left,ctrl+b").describe("Move cursor left in input"),
      input_move_right: z.string().optional().default("right,ctrl+f").describe("Move cursor right in input"),
      input_move_up: z.string().optional().default("up").describe("Move cursor up in input"),
      input_move_down: z.string().optional().default("down").describe("Move cursor down in input"),
      input_select_left: z.string().optional().default("shift+left").describe("Select left in input"),
      input_select_right: z.string().optional().default("shift+right").describe("Select right in input"),
      input_select_up: z.string().optional().default("shift+up").describe("Select up in input"),
      input_select_down: z.string().optional().default("shift+down").describe("Select down in input"),
      input_line_home: z.string().optional().default("ctrl+a").describe("Move to start of line in input"),
      input_line_end: z.string().optional().default("ctrl+e").describe("Move to end of line in input"),
      input_select_line_home: z
        .string()
        .optional()
        .default("ctrl+shift+a")
        .describe("Select to start of line in input"),
      input_select_line_end: z.string().optional().default("ctrl+shift+e").describe("Select to end of line in input"),
      input_visual_line_home: z.string().optional().default("alt+a").describe("Move to start of visual line in input"),
      input_visual_line_end: z.string().optional().default("alt+e").describe("Move to end of visual line in input"),
      input_select_visual_line_home: z
        .string()
        .optional()
        .default("alt+shift+a")
        .describe("Select to start of visual line in input"),
      input_select_visual_line_end: z
        .string()
        .optional()
        .default("alt+shift+e")
        .describe("Select to end of visual line in input"),
      input_buffer_home: z.string().optional().default("home").describe("Move to start of buffer in input"),
      input_buffer_end: z.string().optional().default("end").describe("Move to end of buffer in input"),
      input_select_buffer_home: z
        .string()
        .optional()
        .default("shift+home")
        .describe("Select to start of buffer in input"),
      input_select_buffer_end: z.string().optional().default("shift+end").describe("Select to end of buffer in input"),
      input_delete_line: z.string().optional().default("ctrl+shift+d").describe("Delete line in input"),
      input_delete_to_line_end: z.string().optional().default("ctrl+k").describe("Delete to end of line in input"),
      input_delete_to_line_start: z.string().optional().default("ctrl+u").describe("Delete to start of line in input"),
      input_backspace: z.string().optional().default("backspace,shift+backspace").describe("Backspace in input"),
      input_delete: z.string().optional().default("ctrl+d,delete,shift+delete").describe("Delete character in input"),
      input_undo: z.string().optional().default("ctrl+-,super+z").describe("Undo in input"),
      input_redo: z.string().optional().default("ctrl+.,super+shift+z").describe("Redo in input"),
      input_word_forward: z
        .string()
        .optional()
        .default("alt+f,alt+right,ctrl+right")
        .describe("Move word forward in input"),
      input_word_backward: z
        .string()
        .optional()
        .default("alt+b,alt+left,ctrl+left")
        .describe("Move word backward in input"),
      input_select_word_forward: z
        .string()
        .optional()
        .default("alt+shift+f,alt+shift+right")
        .describe("Select word forward in input"),
      input_select_word_backward: z
        .string()
        .optional()
        .default("alt+shift+b,alt+shift+left")
        .describe("Select word backward in input"),
      input_delete_word_forward: z
        .string()
        .optional()
        .default("alt+d,alt+delete,ctrl+delete")
        .describe("Delete word forward in input"),
      input_delete_word_backward: z
        .string()
        .optional()
        .default("ctrl+w,ctrl+backspace,alt+backspace")
        .describe("Delete word backward in input"),
      history_previous: z.string().optional().default("up").describe("Previous history item"),
      history_next: z.string().optional().default("down").describe("Next history item"),
      session_child_first: z.string().optional().default("<leader>down").describe("Go to first child session"),
      session_child_cycle: z.string().optional().default("right").describe("Go to next child session"),
      session_child_cycle_reverse: z.string().optional().default("left").describe("Go to previous child session"),
      session_parent: z.string().optional().default("up").describe("Go to parent session"),
      terminal_suspend: z.string().optional().default("ctrl+z").describe("Suspend terminal"),
      terminal_title_toggle: z.string().optional().default("none").describe("Toggle terminal title"),
      tips_toggle: z.string().optional().default("<leader>h").describe("Toggle tips on home screen"),
      display_thinking: z.string().optional().default("none").describe("Toggle thinking blocks visibility"),
    })
    .strict()
    .meta({
      ref: "KeybindsConfig",
    })

  export const Server = z
    .object({
      port: z.number().int().positive().optional().describe("Port to listen on"),
      hostname: z.string().optional().describe("Hostname to listen on"),
      publicUrl: z.string().optional().describe("Public base URL used for externally visible attachment links"),
      mdns: z.boolean().optional().describe("Enable mDNS service discovery"),
      mdnsDomain: z.string().optional().describe("Custom domain name for mDNS service (default: opencorvus.local)"),
      cors: z.array(z.string()).optional().describe("Additional domains to allow for CORS"),
    })
    .strict()
    .meta({
      ref: "ServerConfig",
    })

  export const SlackChannel = buildChannelSchema("slack", "SlackChannelConfig")
  export const TelegramChannel = buildChannelSchema("telegram", "TelegramChannelConfig")
  export const DiscordChannel = buildChannelSchema("discord", "DiscordChannelConfig")
  export const FeishuChannel = buildChannelSchema("feishu", "FeishuChannelConfig")
  export const WhatsappChannel = buildChannelSchema("whatsapp", "WhatsappChannelConfig")
  export const GoogleChatChannel = buildChannelSchema("googlechat", "GoogleChatChannelConfig")
  export const MSTeamsChannel = buildChannelSchema("msteams", "MSTeamsChannelConfig")
  export const LineChannel = buildChannelSchema("line", "LineChannelConfig")
  export const MatrixChannel = buildChannelSchema("matrix", "MatrixChannelConfig")
  export const MattermostChannel = buildChannelSchema("mattermost", "MattermostChannelConfig")
  export const SignalChannel = buildChannelSchema("signal", "SignalChannelConfig")
  export const WeComChannel = buildChannelSchema("wecom", "WeComChannelConfig")
  export const DingTalkChannel = buildChannelSchema("dingtalk", "DingTalkChannelConfig")
  export const QQChannel = buildChannelSchema("qq", "QQChannelConfig")

  export const Channel = z
    .object({
      slack: SlackChannel.optional(),
      telegram: TelegramChannel.optional(),
      discord: DiscordChannel.optional(),
      feishu: FeishuChannel.optional(),
      whatsapp: WhatsappChannel.optional(),
      googlechat: GoogleChatChannel.optional(),
      msteams: MSTeamsChannel.optional(),
      line: LineChannel.optional(),
      matrix: MatrixChannel.optional(),
      mattermost: MattermostChannel.optional(),
      signal: SignalChannel.optional(),
      wecom: WeComChannel.optional(),
      dingtalk: DingTalkChannel.optional(),
      qq: QQChannel.optional(),
    })
    .strict()
    .meta({
      ref: "ChannelConfig",
    })



  export const Provider = ModelsDev.Provider.partial()
    .extend({
      whitelist: z.array(z.string()).optional(),
      blacklist: z.array(z.string()).optional(),
      models: z
        .record(
          z.string(),
          ModelsDev.Model.partial().extend({
            variants: z
              .record(
                z.string(),
                z
                  .object({
                    disabled: z.boolean().optional().describe("Disable this variant for the model"),
                  })
                  .catchall(z.any()),
              )
              .optional()
              .describe("Variant-specific configuration"),
          }),
        )
        .optional(),
      options: z
        .object({
          apiKey: z.string().optional(),
          baseURL: z.string().optional(),
          enterpriseUrl: z.string().optional().describe("GitHub Enterprise URL for copilot authentication"),
          setCacheKey: z.boolean().optional().describe("Enable promptCacheKey for this provider (default false)"),
          timeout: z
            .union([
              z
                .number()
                .int()
                .positive()
                .describe(
                  "Timeout in milliseconds for requests to this provider. Default is 300000 (5 minutes). Set to false to disable timeout.",
                ),
              z.literal(false).describe("Disable timeout for this provider entirely."),
            ])
            .optional()
            .describe(
              "Timeout in milliseconds for requests to this provider. Default is 300000 (5 minutes). Set to false to disable timeout.",
            ),
        })
        .catchall(z.any())
        .optional(),
    })
    .strict()
    .meta({
      ref: "ProviderConfig",
    })
  export type Provider = z.infer<typeof Provider>

  export const Info = z
    .object({
      $schema: z.string().optional().describe("JSON schema reference for configuration validation"),
      logLevel: Log.Level.optional().describe("Log level"),
      server: Server.optional().describe("Server configuration for opencorvus serve"),
      channel: Channel.optional().describe("Channel integration configuration"),
      command: z
        .record(z.string(), Command)
        .optional()
        .describe("Command configuration, see https://opencorvus.ai/docs/commands"),
      skills: Skills.optional().describe("Additional skill folder paths"),
      watcher: z
        .object({
          ignore: z.array(z.string()).optional(),
        })
        .optional(),
      plugin: z.string().array().optional(),
      snapshot: z.boolean().optional(),
      share: z
        .enum(["manual", "auto", "disabled"])
        .optional()
        .describe(
          "Control sharing behavior:'manual' allows manual sharing via commands, 'auto' enables automatic sharing, 'disabled' disables all sharing",
        ),
      autoupdate: z
        .union([z.boolean(), z.literal("notify")])
        .optional()
        .describe(
          "Automatically update to the latest version. Set to true to auto-update, false to disable, or 'notify' to show update notifications",
        ),
      disabled_providers: z.array(z.string()).optional().describe("Disable providers that are loaded automatically"),
      enabled_providers: z
        .array(z.string())
        .optional()
        .describe("When set, ONLY these providers will be enabled. All other providers will be ignored"),
      model: ModelId.describe("Model to use in the format of provider/model, eg anthropic/claude-2").optional(),
      small_model: ModelId.describe(
        "Small model to use for tasks like title generation in the format of provider/model",
      ).optional(),
      default_agent: z
        .string()
        .optional()
        .describe(
          "Default agent to use when none is specified. Must be a primary agent. Falls back to 'build' if not set or if the specified agent is invalid.",
        ),
      username: z
        .string()
        .optional()
        .describe("Custom username to display in conversations instead of system username"),
      agent: z
        .object({
          // primary
          plan: Agent.optional(),
          build: Agent.optional(),
          // subagent
          general: Agent.optional(),
          explore: Agent.optional(),
          // specialized
          title: Agent.optional(),
          summary: Agent.optional(),
          compaction: Agent.optional(),
        })
        .catchall(Agent)
        .optional()
        .describe("Agent configuration, see https://opencorvus.ai/docs/agents"),
      provider: z
        .record(z.string(), Provider)
        .optional()
        .describe("Custom provider configurations and model overrides"),
      mcp: z
        .record(
          z.string(),
          z.union([
            Mcp,
            z
              .object({
                enabled: z.boolean(),
              })
              .strict(),
          ]),
        )
        .optional()
        .describe("MCP (Model Context Protocol) server configurations"),
      formatter: z
        .union([
          z.literal(false),
          z.record(
            z.string(),
            z.object({
              disabled: z.boolean().optional(),
              command: z.array(z.string()).optional(),
              environment: z.record(z.string(), z.string()).optional(),
              extensions: z.array(z.string()).optional(),
            }),
          ),
        ])
        .optional(),
      lsp: z
        .union([
          z.literal(false),
          z.record(
            z.string(),
            z.union([
              z.object({
                disabled: z.literal(true),
              }),
              z.object({
                command: z.array(z.string()),
                extensions: z.array(z.string()).optional(),
                disabled: z.boolean().optional(),
                env: z.record(z.string(), z.string()).optional(),
                initialization: z.record(z.string(), z.any()).optional(),
              }),
            ]),
          ),
        ])
        .optional()
        .refine(
          (data) => {
            if (!data) return true
            if (typeof data === "boolean") return true
            const serverIds = new Set(Object.values(LSPServer).map((s) => s.id))

            return Object.entries(data).every(([id, config]) => {
              if (config.disabled) return true
              if (serverIds.has(id)) return true
              return Boolean(config.extensions)
            })
          },
          {
            error: "For custom LSP servers, 'extensions' array is required.",
          },
        ),
      prompt: z
        .record(z.string(), z.string())
        .optional()
        .describe("System-scope prompt overrides keyed by prompt identifier (e.g. core_header)"),
      instructions: z.array(z.string()).optional().describe("Additional instruction files or patterns to include"),
      permission: Permission.optional(),
      tool_permissions: z
        .object({
          websearch:          PermissionAction.optional(),
          webfetch:           PermissionAction.optional(),
          skill:              PermissionAction.optional(),
          external_directory: PermissionAction.optional(),
          task:               PermissionAction.optional(),
          schedule:           PermissionAction.optional(),
        })
        .optional()
        .describe(
          "Default tool permission actions for new tasks. When not set, defaults to 'allow'. " +
          "Set a tool to 'ask' to require confirmation at runtime, or 'deny' to block it entirely.",
        ),
      compaction: z
        .object({
          auto: z.boolean().optional().describe("Enable automatic compaction when context is full (default: true)"),
          prune: z.boolean().optional().describe("Enable pruning of old tool outputs (default: true)"),
          reserved: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe("Token buffer for compaction. Leaves enough window to avoid overflow during compaction."),
        })
        .optional(),
      assistant: z
        .object({
          decompose: z
            .object({
              max_steps: z.number().int().min(1).optional().describe("Maximum agentic steps for requirements agent (default: 30)"),
              timeout_ms: z.number().int().min(1000).optional().describe("Requirements agent timeout in milliseconds (default: 300000)"),
              quality_threshold: z.number().min(0).max(1).optional().describe("Quality score threshold for retry (0.0-1.0, default: 0.5)"),
              max_attempts: z.number().int().min(1).optional().describe("Maximum requirements analysis attempts (default: 3)"),
              skills: z.array(z.string()).optional().describe("Additional skill paths for requirements agent"),
            })
            .optional()
            .describe("Requirements agent configuration — analyzes input, extracts requirements, decomposes into goal contracts"),
          architect: z
            .object({
              max_steps: z.number().int().min(1).optional().describe("Maximum agentic steps for architect agent (default: 20)"),
              timeout_ms: z.number().int().min(1000).optional().describe("Architect agent timeout in milliseconds (default: 180000)"),
              skills: z.array(z.string()).optional().describe("Additional skill paths for architect agent"),
              model: z.string().optional().describe("Model override for architect agent"),
            })
            .optional()
            .describe("Architect agent configuration — cross-goal coordination, interface contracts"),
          planner: z
            .object({
              max_steps: z.number().int().min(1).optional().describe("Maximum agentic steps for planner agent (default: 30)"),
              timeout_ms: z.number().int().min(1000).optional().describe("Planner agent timeout in milliseconds (default: 300000)"),
              quality_threshold: z.number().min(0).max(1).optional().describe("Quality score threshold for retry (0.0-1.0, default: 0.5)"),
              max_attempts: z.number().int().min(1).optional().describe("Maximum plan generation attempts (default: 3)"),
              skills: z.array(z.string()).optional().describe("Additional skill paths for planner agent"),
            })
            .optional()
            .describe("Planner agent configuration"),
          evaluator: z
            .object({
              max_steps: z.number().int().min(1).optional().describe("Maximum agentic steps for evaluator agent (default: 25)"),
              timeout_ms: z.number().int().min(1000).optional().describe("Evaluator agent timeout in milliseconds (default: 240000)"),
              model: z.string().optional().describe("Model to use for evaluator agent (e.g. 'github-copilot/claude-haiku-4-5'). Defaults to the project default model."),
              tier: z.enum(["core", "standard", "full"]).optional().describe("Evaluation tier: 'core' (build/test/lint only), 'standard' (+ judge/spec_check), 'full' (all checks). Default: 'standard'."),
              skills: z.array(z.string()).optional().describe("Additional skill paths for evaluator agent"),
            })
            .optional()
            .describe("Evaluator agent configuration"),
          delivery: z
            .object({
              max_steps: z.number().int().min(1).optional().describe("Maximum agentic steps for delivery agent (default: 40)"),
              timeout_ms: z.number().int().min(1000).optional().describe("Delivery agent timeout in milliseconds (default: 600000)"),
              max_retries: z.number().int().min(0).optional().describe("Maximum delivery generation retries (default: 2)"),
              skills: z.array(z.string()).optional().describe("Additional skill paths for delivery agent"),
            })
            .optional()
            .describe("Delivery agent configuration"),
          design_analyst: z
            .object({
              max_steps: z.number().int().min(1).optional().describe("Maximum agentic steps for design analyst agent (default: 50)"),
              timeout_ms: z.number().int().min(1000).optional().describe("Design analyst agent timeout in milliseconds (default: 300000)"),
              skills: z.array(z.string()).optional().describe("Additional skill paths for design analyst agent"),
              model: z.string().optional().describe("Model override for design analyst agent"),
            })
            .optional()
            .describe("Design analyst agent configuration — analyzes visual references (images, URLs) to produce structured design specifications"),
          max_runs: z.number().int().min(1).optional().describe("Maximum total task runs (default: 10)"),
          max_fix_runs: z.number().int().min(0).optional().describe("Maximum fix runs after failure (default: 5)"),
          max_goal_retries: z.number().int().min(0).optional().describe("Maximum retries per individual goal before permanently failing it (default: 3)"),
          max_executor_groups: z.number().int().min(1).optional().describe("Maximum parallel executor groups (default: 5)"),
          default_workflow: z.string().optional().describe("Default workflow for new tasks: 'standard', 'quick-fix', 'plan-only', or custom ID (default: 'standard')"),
          workflows: z
            .array(
              z.object({
                id: z.string().describe("Workflow unique ID"),
                name: z.string().describe("Display name"),
                description: z.string().optional().describe("One-line description"),
                steps: z.array(
                  z.object({
                    id: z.string().describe("Step unique ID within workflow"),
                    tool: z.string().describe("Task Agent tool name this step maps to"),
                    label: z.string().describe("UI display label"),
                    hint: z.string().optional().describe("Brief guidance injected into system prompt"),
                    scope: z.enum(["task", "goal"]).describe("task = once per task, goal = once per goal"),
                    skippable: z.boolean().optional().describe("Whether Task Agent can skip this step"),
                    after: z.array(z.string()).optional().describe("Prerequisite step IDs"),
                  }),
                ),
                goalLoopStepIDs: z.array(z.string()).optional().describe("Step IDs forming the per-goal loop (for UI grouping)"),
              }),
            )
            .optional()
            .describe("Custom workflow definitions. Override built-in workflows by matching ID."),
        })
        .optional()
        .describe("Assistant agent configuration — controls decompose, planner, evaluator, and delivery agent behavior"),
      experimental: z
        .object({
          disable_paste_summary: z.boolean().optional(),
          batch_tool: z.boolean().optional().describe("Enable the batch tool"),
          openTelemetry: z
            .boolean()
            .optional()
            .describe("Enable OpenTelemetry spans for AI SDK calls (using the 'experimental_telemetry' flag)"),
          primary_tools: z
            .array(z.string())
            .optional()
            .describe("Tools that should only be available to primary agents."),
          continue_loop_on_deny: z.boolean().optional().describe("Continue the agent loop when a tool call is denied"),
          unattended: z
            .boolean()
            .optional()
            .describe("Enable unattended mode — auto-approve permissions and auto-reject stale interactions"),
          auto_permission: z
            .boolean()
            .optional()
            .describe("Auto-approve permission requests in unattended mode (default: false)"),
          auto_question: z
            .boolean()
            .optional()
            .describe("Auto-answer clarification questions in unattended mode (default: false)"),
          mcp_timeout: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("Timeout in milliseconds for model context protocol (MCP) requests"),
          memory: z
            .object({
              enabled: z.boolean().optional().describe("Enable persistent memory store (default: true)"),
              auto_inject: z
                .boolean()
                .optional()
                .describe("Auto-inject relevant memories into system prompt (default: true)"),
              token_budget: z
                .number()
                .int()
                .min(100)
                .optional()
                .describe("Max tokens for auto-injected memory context (default: 2000)"),
            })
            .optional()
            .describe("Persistent memory configuration"),
        })
        .optional(),
    })
    .strict()
    .meta({
      ref: "Config",
    })

  export type Info = z.output<typeof Info>

  export const global = lazy(async () => {
    let result: Info = pipe(
      {},
      mergeDeep(await loadFile(path.join(Global.Path.config, "config.json"))),
      mergeDeep(await loadFile(path.join(Global.Path.config, "opencorvus.json"))),
      mergeDeep(await loadFile(path.join(Global.Path.config, "opencorvus.jsonc"))),
    )

    return result
  })

  export const { readFile } = ConfigPaths

  async function loadFile(filepath: string): Promise<Info> {
    log.info("loading", { path: filepath })
    const text = await readFile(filepath)
    if (!text) return {}
    return load(text, { path: filepath })
  }

  async function load(text: string, options: { path: string } | { dir: string; source: string }) {
    const original = text
    const source = "path" in options ? options.path : options.source
    const isFile = "path" in options
    const data = await ConfigPaths.parseText(
      text,
      "path" in options ? options.path : { source: options.source, dir: options.dir },
    )

    const parsed = Info.safeParse(data)
    if (parsed.success) {
      if (!parsed.data.$schema && isFile) {
        parsed.data.$schema = "https://opencorvus.ai/config.json"
        const updated = original.replace(/^\s*\{/, '{\n  "$schema": "https://opencorvus.ai/config.json",')
        await Bun.write(options.path, updated)
      }
      const data = parsed.data
      if (data.plugin && isFile) {
        for (let i = 0; i < data.plugin.length; i++) {
          const plugin = data.plugin[i]
          try {
            data.plugin[i] = import.meta.resolve!(plugin, options.path)
          } catch (e) {
            try {
              // import.meta.resolve sometimes fails with newly created node_modules
              const require = createRequire(options.path)
              const resolvedPath = require.resolve(plugin)
              data.plugin[i] = pathToFileURL(resolvedPath).href
            } catch {
              // Ignore, plugin might be a generic string identifier like "mcp-server"
            }
          }
        }
      }
      return data
    }

    throw new InvalidError({
      path: source,
      issues: parsed.error.issues,
    })
  }
  export const { JsonError, InvalidError } = ConfigPaths

  export const ConfigDirectoryTypoError = NamedError.create(
    "ConfigDirectoryTypoError",
    z.object({
      path: z.string(),
      dir: z.string(),
      suggestion: z.string(),
    }),
  )

  export async function get() {
    return state().then((x) => x.config)
  }

  export async function getGlobal() {
    return global()
  }

  export function projectConfigDirectory() {
    return path.join(Instance.directory, ".opencorvus")
  }

  export function projectConfigFile() {
    const candidates = ["opencorvus.jsonc", "opencorvus.json"].map((file) =>
      path.join(projectConfigDirectory(), file),
    )
    for (const file of candidates) {
      if (existsSync(file)) return file
    }
    return candidates[0]
  }

  export async function update(config: Info) {
    await fs.mkdir(projectConfigDirectory(), { recursive: true })
    const merged = await writeConfigFile(projectConfigFile(), config)
    // Reset cached config state without destroying the instance.
    // Instance.dispose() would kill running sessions (executor, evaluator)
    // and cause race conditions with concurrent assistant operations.
    state.reset()
    global.reset()
    // Notify all connected clients that config changed
    GlobalBus.emit("event", {
      directory: "config",
      payload: {
        type: "config.changed",
        properties: merged ?? {},
      },
    })
  }

  function globalConfigFile() {
    const candidates = ["opencorvus.jsonc", "opencorvus.json", "config.json"].map((file) =>
      path.join(Global.Path.config, file),
    )
    for (const file of candidates) {
      if (existsSync(file)) return file
    }
    return candidates[0]
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value)
  }

  function patchJsonc(input: string, patch: unknown, path: string[] = []): string {
    if (!isRecord(patch)) {
      const edits = modify(input, path, patch, {
        formattingOptions: {
          insertSpaces: true,
          tabSize: 2,
        },
      })
      return applyEdits(input, edits)
    }

    return Object.entries(patch).reduce((result, [key, value]) => {
      if (value === undefined) return result
      return patchJsonc(result, value, [...path, key])
    }, input)
  }

  function parseConfig(text: string, filepath: string): Info {
    const errors: JsoncParseError[] = []
    const data = parseJsonc(text, errors, { allowTrailingComma: true })
    if (errors.length) {
      const lines = text.split("\n")
      const errorDetails = errors
        .map((e) => {
          const beforeOffset = text.substring(0, e.offset).split("\n")
          const line = beforeOffset.length
          const column = beforeOffset[beforeOffset.length - 1].length + 1
          const problemLine = lines[line - 1]

          const error = `${printParseErrorCode(e.error)} at line ${line}, column ${column}`
          if (!problemLine) return error

          return `${error}\n   Line ${line}: ${problemLine}\n${"".padStart(column + 9)}^`
        })
        .join("\n")

      throw new JsonError({
        path: filepath,
        message: `\n--- JSONC Input ---\n${text}\n--- Errors ---\n${errorDetails}\n--- End ---`,
      })
    }

    const parsed = Info.safeParse(data)
    if (parsed.success) return parsed.data

    throw new InvalidError({
      path: filepath,
      issues: parsed.error.issues,
    })
  }

  async function writeConfigFile(filepath: string, config: Info) {
    const before = await Filesystem.readText(filepath).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return "{}"
      throw new JsonError({ path: filepath }, { cause: err })
    })

    return filepath.endsWith(".jsonc")
      ? (async () => {
          const updated = patchJsonc(before, config)
          const merged = parseConfig(updated, filepath)
          await Filesystem.write(filepath, updated)
          return merged
        })()
      : (async () => {
          const existing = parseConfig(before, filepath)
          const merged = mergeDeep(existing, config)
          await Filesystem.writeJson(filepath, merged)
          return merged
        })()
  }

  export async function updateGlobal(config: Info) {
    const filepath = globalConfigFile()
    const next = await writeConfigFile(filepath, config)

    global.reset()
    // Do NOT disposeAll — kills running executor sessions. global.reset() is sufficient.
    GlobalBus.emit("event", {
      directory: "global",
      payload: {
        type: Event.Disposed.type,
        properties: {},
      },
    })

    return next
  }

  export async function directories() {
    return state().then((x) => x.directories)
  }
}
