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
import { parseEnvJson } from "./parse-env-json"
import {
  type ParseError as JsoncParseError,
  applyEdits,
  modify,
  parse as parseJsonc,
  printParseErrorCode,
} from "jsonc-parser"
import { Instance, lazyInstanceState } from "../project/instance"
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
import { withKeyedLock } from "@/util/lock"
import { AgentRoleContract, type AgentRoleID } from "@/agent/role-contract"
import { isModelReference } from "@/provider/model-ref"
import { BrowserMCPBuiltin } from "@/mcp/browser/builtin"

export namespace Config {
  const ModelId = z
    .string()
    .refine(isModelReference, {
      message: 'Model must be in the format "provider/model".',
    })
    .meta({ $ref: "https://models.dev/model-schema.json#/$defs/Model" })
  export const DEFAULT_MODEL = "hexin/kimi-k2.6"

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

  export const state = lazyInstanceState(async () => {
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
    result.experimental = {
      auto_question: true,
      confirm_proposed_tasks: false,
      ...(result.experimental ?? {}),
    }

    const directories = await ConfigPaths.directories(Instance.directory, Instance.worktree)

    // .opencorvus directory config overrides (project and global) config sources.
    if (Flag.OPENCORVUS_CONFIG_DIR) {
      log.debug("loading config from OPENCORVUS_CONFIG_DIR", { path: Flag.OPENCORVUS_CONFIG_DIR })
    }

    const deps: Promise<void>[] = []

    for (const dir of unique(directories)) {
      const isOpencorvusDir =
        dir.endsWith(".opencorvus") || dir === Flag.OPENCORVUS_CONFIG_DIR || dir === Global.Path.config
      if (isOpencorvusDir) {
        for (const file of ["opencorvus.jsonc", "opencorvus.json"]) {
          log.debug(`loading config from ${path.join(dir, file)}`)
          result = mergeConfigConcatArrays(result, await loadFile(path.join(dir, file)))
          // to satisfy the type checker
          result.agent ??= {}
          result.plugin ??= []
        }
      }

      // The plugin manifest install (`@opencorvus-ai/plugin` written as
      // `package.json` + node_modules) MUST stay inside opencorvus-owned
      // directories: the global config root, the project's `.opencorvus/`,
      // or an explicit `OPENCORVUS_CONFIG_DIR`. Writing it into a directory
      // walked-to from `Instance.directory` (e.g. the project root itself,
      // when a `.opencorvus/` sibling sits one level up) would drop an
      // untracked `package.json` into the user's primary worktree — which
      // then collides with build-agent commits at `git merge --ff-only`
      // time. Those collisions were the root cause of the 2026-04-29
      // gemini-task scaffold merge failure.
      if (isOpencorvusDir) {
        deps.push(
          iife(async () => {
            const shouldInstall = await needsInstall(dir)
            if (shouldInstall) await installDependencies(dir)
          }),
        )
      }

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
      // audit-2026-04-29 W2-V22 — descriptive parse error helper
      // (see parseEnvJson) replaces the bare `JSON.parse` so a typo
      // in OPENCORVUS_PERMISSION surfaces as an actionable line
      // instead of "Unexpected token in JSON at position N".
      const parsed = parseEnvJson("OPENCORVUS_PERMISSION", Flag.OPENCORVUS_PERMISSION)
      result.permission = mergeDeep((result.permission ?? {}) as object, parsed as object) as Config.Permission
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
    result = materializeNativeAgentModels(result)
    result = materializeBuiltinMcp(result)

    // NOTE: first-load auto-write of resolved config to the project directory
    // was removed (spec §6-2, rule 7/8). It wrote `result.model ??= DEFAULT_MODEL`
    // AND a frozen copy of the global-merged config into the project file, so
    // the project file permanently shadowed global config — the root cause of
    // "model 反复覆盖". Config now resolves in-memory only; a project config
    // file exists ONLY when explicitly created. With no model configured
    // anywhere, resolveAgentModel throws MissingModelConfigError (strict,
    // explicit — no DEFAULT_MODEL fallback).

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

    // File exists — let malformed JSON propagate rather than treat it the
    // same as missing. If package.json is corrupt the operator needs to see
    // the parse error, not a silent "plugin needs reinstall" loop.
    const parsed = await Filesystem.readJson<{ dependencies?: Record<string, string> }>(pkg)
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

  function materializeBuiltinMcp(config: Info): Info {
    const existing = config.mcp?.[BrowserMCPBuiltin.ServerName]
    if (existing) return config
    return {
      ...config,
      mcp: {
        ...(config.mcp ?? {}),
        [BrowserMCPBuiltin.ServerName]: BrowserMCPBuiltin.localConfig(),
      },
    }
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
          search_code: PermissionRule.optional(),
          list: PermissionRule.optional(),
          bash: PermissionRule.optional(),
          task: PermissionRule.optional(),
          external_directory: PermissionRule.optional(),
          todowrite: PermissionAction.optional(),
          todoread: PermissionAction.optional(),
          question: PermissionAction.optional(),
          webfetch: PermissionAction.optional(),
          websearch: PermissionAction.optional(),
          external_code_search: PermissionAction.optional(),
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
      prompt_append: z
        .string()
        .optional()
        .describe("Additional instructions appended after a code-owned stage-agent core prompt."),
      disable: z.boolean().optional(),
      description: z.string().optional().describe("Description of when to use the agent"),
      mode: z.enum(["subagent", "primary", "all"]).optional(),
      hidden: z
        .boolean()
        .optional()
        .describe("Hide this subagent from the @ autocomplete menu (only applies to mode: subagent)"),
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
      tools: z
        .object({
          include: z.array(z.string()).optional(),
          exclude: z.array(z.string()).optional(),
        })
        .optional()
        .describe("Tool adapter: whitelist (include) or blacklist (exclude) of tool IDs visible to this agent"),
    })
    .catchall(z.any())
    .transform((agent) => {
      const knownKeys = new Set([
        "name",
        "model",
        "variant",
        "prompt",
        "prompt_append",
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
        "tools",
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
        tools?: { include?: string[]; exclude?: string[] }
      }
    })
    .meta({
      ref: "AgentConfig",
    })
  export type Agent = z.infer<typeof Agent>

  // Session overlay: the EXACT subset of config a session may override
  // (decision §6-1, widest set). `.strict()` is the pinned-invariant guard
  // (design principle 5): any key NOT listed here — permission, tools, mcp,
  // provider creds, paths — is rejected at the schema boundary, so a session
  // can never weaken project security/cost boundaries.
  // Every overlay value is `.nullable()`: a session overlay is an RFC 7396
  // merge-patch, so `null` is a first-class, schema-validated "delete this
  // override" signal (NOT an out-of-band `as never`). This keeps the gate
  // (Overlay) and the merge API (mergeOverlay) in lockstep.
  const OverlayAgent = z
    .object({
      // ModelId reused from the single source so model format stays in sync.
      model: ModelId.nullable().optional(),
      // variant selects a model variant for the agent's configured model — it
      // is part of the model-selection family opened by decision §6-1.
      variant: z.string().nullable().optional(),
      temperature: z.number().nullable().optional(),
      top_p: z.number().nullable().optional(),
      prompt: z.string().nullable().optional(),
      prompt_append: z.string().nullable().optional(),
    })
    .strict()

  // Exact session-overridable surface (decision §6-1 "widest"; spec §5/§13):
  // model + variant + temperature + top_p + agent prompt/prompt_append, plus
  // the system-scope prompt record (same shape as Info.prompt by design — a
  // session may override any prompt slot; prompts carry no security/cost
  // boundary, unlike the .strict()-excluded permission/tools/mcp/provider).
  export const Overlay = z
    .object({
      model: ModelId.nullable().optional(),
      prompt: z
        .record(z.string(), z.string().nullable())
        .nullable()
        .optional(),
      agent: z.record(z.string(), OverlayAgent.nullable()).nullable().optional(),
    })
    .strict()
  export type Overlay = z.output<typeof Overlay>

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
      mdnsDomain: z.string().optional().describe("Custom domain name for mDNS service"),
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

  export const TerminalProfile = z
    .object({
      label: z.string().min(1).describe("Human-readable terminal profile label"),
      command: z.string().min(1).describe("Executable path or command resolved by the configured environment"),
      args: z.array(z.string()).optional().default([]).describe("Executable arguments, not shell-split from a string"),
      env: z
        .record(z.string(), z.string())
        .optional()
        .default({})
        .describe("Profile-owned terminal environment variables"),
      icon: z
        .enum(["terminal", "powershell", "command-prompt", "bash"])
        .optional()
        .describe("Terminal profile icon hint surfaced by Overlay launch controls"),
    })
    .strict()
    .meta({
      ref: "TerminalProfileConfig",
    })
  export type TerminalProfile = z.infer<typeof TerminalProfile>

  export const Terminal = z
    .object({
      default_profile_id: z.string().min(1).optional().describe("Default terminal profile id used by Overlay"),
      profiles: z.record(z.string(), TerminalProfile).optional().describe("Server-owned terminal profiles"),
    })
    .strict()
    .meta({
      ref: "TerminalConfig",
    })
  export type Terminal = z.infer<typeof Terminal>

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
      model: ModelId.describe(`Model to use in the format of provider/model, eg ${DEFAULT_MODEL}`).optional(),
      small_model: ModelId.describe(
        "Small model to use for tasks like title generation in the format of provider/model",
      ).optional(),
      default_agent: z
        .string()
        .optional()
        .describe(
          "Default agent to use when none is specified. Must be a primary agent. When omitted, the built-in default is 'coding'; an invalid configured agent is an error.",
        ),
      username: z
        .string()
        .optional()
        .describe("Custom username to display in conversations instead of system username"),
      locale: z
        .enum(["en-US", "zh-CN"])
        .optional()
        .describe("Operator-selected system language used for assistant replies and Overlay localization."),
      agent: z
        .object({
          // primary
          coding: Agent.optional(),
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
                enabled: z.literal(false),
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
          websearch: PermissionAction.optional(),
          webfetch: PermissionAction.optional(),
          skill: PermissionAction.optional(),
          external_directory: PermissionAction.optional(),
          task: PermissionAction.optional(),
          schedule: PermissionAction.optional(),
        })
        .optional()
        .describe(
          "Default tool permission actions for new tasks. When not set, defaults to 'allow'. " +
            "Set a tool to 'ask' for confirmation, or 'deny' to block it entirely.",
        ),
      terminal: Terminal.optional().describe("Server-owned Overlay terminal configuration."),
      compaction: z
        .object({
          auto: z.boolean().optional().describe("Enable automatic compaction when context is full"),
          prune: z.boolean().optional().describe("Enable pruning of old tool outputs"),
          reserved: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe("Token buffer for compaction. Leaves enough window to avoid overflow during compaction."),
          threshold: z
            .number()
            .min(0.1)
            .max(1)
            .optional()
            .describe(
              "Fraction of usable context (after reserved buffer) that must be consumed before auto-compaction triggers. Defaults to 0.9 — compact late enough to use more of the available prompt window while still preserving reserved reply headroom.",
            ),
          tail_turns: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe("Number of most recent real user turns to preserve verbatim after compaction. Defaults to 2."),
          preserve_recent_tokens: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe("Token budget for the verbatim recent-tail retained after compaction."),
        })
        .optional(),
      assistant: z
        .object({
          auto_iteration: z
            .boolean()
            .optional()
            .describe(
              "Enable OpenCorvus host-side automatic repair iteration after failed goal waves or rejected acceptance reviews. Default false: acceptance rejection is reported and waits for operator follow-up.",
            ),
          requirements: z
            .object({
              max_steps: z.number().int().min(1).optional().describe("Maximum agentic steps for requirements agent"),
            })
            .optional()
            .describe(
              "Requirements agent configuration — analyzes input, extracts requirements, decomposes into goal contracts",
            ),
          architect: z
            .object({
              max_steps: z.number().int().min(1).optional().describe("Maximum agentic steps for architect agent"),
            })
            .optional()
            .describe(
              "Architect agent configuration — cross-goal coordination, interface contracts. Model is configured via agent.architect.model.",
            ),
          delivery_visual: z
            .object({
              phash_hamming_max: z
                .number()
                .int()
                .min(0)
                .max(64)
                .optional()
                .describe("P0-B hard gate: pHash Hamming distance upper bound (structure)"),
              ssim_min: z
                .number()
                .min(0)
                .max(1)
                .optional()
                .describe("P0-B hard gate: mean SSIM lower bound (texture/detail)"),
              chart_region_density_min_ratio: z
                .number()
                .min(0)
                .max(1)
                .optional()
                .describe("P0-B hard gate: chart-region non-white density ratio lower bound (anti empty-skeleton)"),
              unique_color_ratio_min: z
                .number()
                .min(0)
                .max(1)
                .optional()
                .describe("P0-B hard gate: unique-color ratio lower bound (anti monochrome placeholder)"),
              text_hit_ratio_min: z
                .number()
                .min(0)
                .max(1)
                .optional()
                .describe("P0-B hard gate: reference_strings hit ratio lower bound (anti placeholder copy)"),
              score_weights: z
                .object({
                  phash: z.number().min(0).max(1).optional(),
                  ssim: z.number().min(0).max(1).optional(),
                  density: z.number().min(0).max(1).optional(),
                  text_hit: z.number().min(0).max(1).optional(),
                })
                .optional()
                .describe("Composite score weights; four values must sum to 1 (runtime-enforced)"),
            })
            .optional()
            .describe("P0-B visual numeric evidence thresholds."),
          frontend_design: z
            .object({
              max_steps: z.number().int().min(1).optional().describe("Maximum agentic steps for frontend design agent"),
            })
            .optional()
            .describe(
              'Frontend design/replica agent configuration - analyzes visual references (images, URLs) into a frontend template, fillable modules, component/material inventories, and visual/data contracts. Model is configured via agent."frontend-design".model.',
            ),
          intent_analysis: z
            .object({
              max_steps: z.number().int().min(1).optional().describe("Maximum agentic steps for intent-analysis agent"),
            })
            .optional()
            .describe(
              'Intent-analysis agent configuration — front-of-pipeline intent disambiguation. Model is configured via agent."intent-analysis".model.',
            ),
          build: z
            .object({
              max_steps: z.number().int().min(1).optional().describe("Maximum agentic steps for build agent"),
            })
            .optional()
            .describe(
              'Build agent configuration — per-goal build session. Model is configured via agent."build".model.',
            ),
          activity: z
            .object({
              session_llm_idle_ms: z
                .number()
                .int()
                .min(1000)
                .optional()
                .describe("Max idle (no stream chunk) window for session LLM streams, ms"),
              executor_events_idle_ms: z
                .number()
                .int()
                .min(1000)
                .optional()
                .describe("Max idle window for the executor event queue, ms"),
              task_queue_run_timeout_ms: z
                .number()
                .int()
                .min(1000)
                .optional()
                .describe("Total wall-clock cap for a single queued task run, ms"),
            })
            .optional()
            .describe(
              "Chunk-driven inactivity gates. Single source of truth for streaming layers (session LLM, executor events, task queue).",
            ),
          debug: z
            .object({
              fail_on_information_missing: z
                .boolean()
                .optional()
                .describe(
                  "When true, the host injects an INFORMATION MISSING fallback section into every agent's system prompt and exits the process with code 99 the moment any agent emits the <INFORMATION MISSING> XML block. Use as a debug toggle to surface upstream-context drops; default false. Toggle from the overlay GeneralPanel.",
                ),
            })
            .optional()
            .describe(
              "Operator-toggled debug behaviour. Settings here are diagnostic — they affect host runtime decisions and prompt content.",
            ),
          max_executor_groups: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe("Maximum parallel agent sessions in fan-out phases such as goal builds and integrity reviewers"),
          default_workflow: z
            .string()
            .optional()
            .describe(
              "Default workflow for new tasks: 'direct' (build), 'pipeline' (frontend_design → requirements → architect → per-goal build → integrity), or custom ID",
            ),
          workflows: z
            .array(
              z.object({
                id: z.string().describe("Workflow unique ID"),
                name: z.string().describe("Display name"),
                description: z.string().optional().describe("One-line description"),
                steps: z.array(
                  z.object({
                    id: z.string().describe("Step unique ID within workflow"),
                    tool: z.string().describe("Orchestrator tool name this step maps to"),
                    label: z.string().describe("UI display label"),
                    hint: z.string().optional().describe("Brief guidance injected into system prompt"),
                    scope: z.enum(["task", "goal"]).describe("task = once per task, goal = once per goal"),
                    skippable: z.boolean().optional().describe("Whether Orchestrator can skip this step"),
                    after: z.array(z.string()).optional().describe("Prerequisite step IDs"),
                  }),
                ),
                goalLoopStepIDs: z
                  .array(z.string())
                  .optional()
                  .describe("Step IDs forming the per-goal loop (for UI grouping)"),
              }),
            )
            .optional()
            .describe("Custom workflow definitions. Override built-in workflows by matching ID."),
        })
        .optional()
        .describe(
          "Assistant agent configuration — controls orchestration policy, requirements, architect, build, frontend-design, intent-analysis, and integrity review behavior",
        ),
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
          auto_question: z
            .boolean()
            .optional()
            .default(true)
            .describe(
              "Auto-reject unanswered question interactions after the five-minute stale timeout. Independent fine-grained switch. When false, questions wait indefinitely for a user reply.",
            ),
          confirm_proposed_tasks: z
            .boolean()
            .optional()
            .default(false)
            .describe(
              "Require operator confirmation before the orchestrator creates a proposed follow-up task. Default false lets the orchestrator create the task directly.",
            ),
          mcp_timeout: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("Timeout in milliseconds for model context protocol (MCP) requests"),
          memory: z
            .object({
              enabled: z.boolean().optional().describe("Enable persistent memory store"),
              auto_inject: z.boolean().optional().describe("Auto-inject relevant memories into system prompt"),
              token_budget: z
                .number()
                .int()
                .min(100)
                .optional()
                .describe("Max tokens for auto-injected memory context"),
            })
            .optional()
            .describe("Persistent memory configuration"),
        })
        .optional(),
    })
    .strict()
    .superRefine((config, ctx) => {
      for (const [agentID, agentConfig] of Object.entries(config.agent ?? {})) {
        if (!agentConfig) continue
        const configuredName = (agentConfig as { name?: unknown }).name
        if (configuredName !== undefined && configuredName !== agentID) {
          ctx.addIssue({
            code: "custom",
            path: ["agent", agentID, "name"],
            message: `config.agent.${agentID}.name cannot rename the agent identity; use the config key as the agent id.`,
          })
        }

        const role = AgentRoleContract.all[agentID as AgentRoleID]
        if (role?.promptConfigMode === "append" && agentConfig.prompt !== undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["agent", agentID, "prompt"],
            message: `config.agent.${agentID}.prompt is invalid for append-mode agents; use prompt_append.`,
          })
        }
        if (role?.promptConfigMode === "none" && (agentConfig.prompt !== undefined || agentConfig.prompt_append !== undefined)) {
          ctx.addIssue({
            code: "custom",
            path: ["agent", agentID],
            message: `config.agent.${agentID} prompt configuration is not editable.`,
          })
        }
      }
    })
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
    const candidates = ["opencorvus.jsonc", "opencorvus.json"].map((file) => path.join(projectConfigDirectory(), file))
    for (const file of candidates) {
      if (existsSync(file)) return file
    }
    return candidates[0]
  }

  export async function update(config: Info) {
    await fs.mkdir(projectConfigDirectory(), { recursive: true })
    const merged = await writeConfigFile(
      projectConfigFile(),
      materializeNativeAgentModels(config, {
        topLevelModelWrite: typeof config.model === "string",
      }),
    )
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
      // RFC 7396: a null value in the patch signals deletion of that key.
      // jsonc-parser's modify() removes the key when the value is undefined.
      const valueToWrite = patch === null ? undefined : patch
      const edits = modify(input, path, valueToWrite, {
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

  function materializeNativeAgentModels(config: Info, options: { topLevelModelWrite?: boolean } = {}): Info {
    if (!config.model) return config

    const agent = { ...(config.agent ?? {}) } as NonNullable<Info["agent"]>
    let changed = config.agent === undefined

    for (const agentID of Object.keys(AgentRoleContract.all) as AgentRoleID[]) {
      const current = agent[agentID] ?? {}
      const patchProvidedModel = config.agent?.[agentID]?.model !== undefined
      if (!options.topLevelModelWrite && current.model) continue
      if (options.topLevelModelWrite && patchProvidedModel) continue

      agent[agentID] = {
        ...current,
        model: config.model,
      }
      changed = true
    }

    return changed ? { ...config, agent } : config
  }

  // RFC 7396-compatible deep merge: null values in the source delete the
  // corresponding key from the target, matching patchJsonc's behavior.
  function mergeWithNullDelete(target: any, source: any): any {
    if (!isRecord(target) || !isRecord(source)) return source
    const result: Record<string, unknown> = { ...target }
    for (const [k, v] of Object.entries(source)) {
      if (v === null) {
        delete result[k]
      } else if (isRecord(v) && isRecord(result[k])) {
        result[k] = mergeWithNullDelete(result[k], v)
      } else {
        result[k] = v
      }
    }
    return result
  }

  // THE single API for applying a sparse session overlay onto a base config.
  // A session overlay is exactly an RFC 7396 merge-patch (sparse delta, null
  // deletes a key), so this reuses the existing mergeWithNullDelete primitive
  // rather than reimplementing deep/null-delete merge (single source — the
  // overlay schema forbids array keys, so the file-load concat-array layering
  // in mergeConfigConcatArrays is a different operation, not a parallel impl).
  // `base` (the Instance-cached project config) MUST stay immutable: callers
  // hold the resolved config and may mutate nested objects. mergeWithNullDelete
  // only shallow-clones each touched level, so unpatched nested subtrees would
  // alias `base` and a later mutation would silently pollute the shared cache
  // (the exact §8.3 pollution this design exists to prevent). structuredClone
  // fully de-aliases the result from `base`.
  export function mergeOverlay(base: Info, patch: Overlay): Info {
    return structuredClone(mergeWithNullDelete(base, patch)) as Info
  }

  // Serializes read-modify-write of each config file. Two concurrent
  // PATCH /config requests (e.g. user picks build=A then integrity=B in the
  // overlay panel before the first save returns) would otherwise both
  // readText() against the same "before" snapshot and the second write would
  // clobber the first agent's override. Keyed by absolute filepath so the
  // project file and the global file get independent locks.
  const writeConfigLocks = new Map<string, Promise<unknown>>()

  async function writeConfigFile(filepath: string, config: Info) {
    return withKeyedLock(writeConfigLocks, filepath, async () => {
      const before = await Filesystem.readText(filepath).catch((err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") return "{}"
        throw new JsonError({ path: filepath }, { cause: err })
      })

      if (filepath.endsWith(".jsonc")) {
        const updated = patchJsonc(before, config)
        const merged = parseConfig(updated, filepath)
        await Filesystem.write(filepath, updated)
        return merged
      }
      const existing = parseConfig(before, filepath)
      const merged = mergeWithNullDelete(existing, config)
      await Filesystem.writeJson(filepath, merged)
      return merged
    })
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
