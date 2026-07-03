import path from "node:path"
import {
  DEFAULT_PROMPT_PROFILE_ID,
  PromptProfile,
  PromptProfileCatalogSchema,
  PromptProfileIDSchema,
  type PromptProfileCatalog,
  type PromptProfileCatalogProfile,
  type PromptProfileConfig,
  type PromptProfileDefinition,
} from "@/agent/prompt-profile"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { Filesystem } from "@/util/filesystem"
import { ExpertSquadRegistry } from "./registry"

type ConfigLike = {
  prompt_profile?: PromptProfileConfig
}

export namespace PromptProfileResolver {
  export interface ProjectScope {
    projectDirectory?: string
  }

  export interface CatalogInput extends ProjectScope {
    config: ConfigLike
    projectActive?: string
    sessionActive?: string | null
  }

  export interface PromptInput extends ProjectScope {
    agentID: string
    config: ConfigLike
  }

  export interface ComposeInput extends PromptInput {
    base: string
    userAppend?: string | null
  }

  export interface ProfileIDInput extends ProjectScope {
    profileID: string
  }

  function canonicalBase(projectDirectory: string) {
    return path.join(ProjectRuntimePaths.projectConfigRoot(Filesystem.resolve(projectDirectory)), ExpertSquadRegistry.DIRECTORY)
  }

  function assertNoBuiltInCollision(profileID: string) {
    if (Object.hasOwn(PromptProfile.builtIns, profileID)) {
      throw new Error(`Project expert squad package id ${JSON.stringify(profileID)} collides with a built-in expert squad id.`)
    }
  }

  async function projectPromptProfiles(projectDirectory: string): Promise<Record<string, PromptProfileDefinition>> {
    const result: Record<string, PromptProfileDefinition> = {}
    for (const entry of await ExpertSquadRegistry.discover(projectDirectory)) {
      assertNoBuiltInCollision(entry.id)
      const loaded = await ExpertSquadRegistry.loadPackage(path.join(canonicalBase(projectDirectory), entry.id))
      assertNoBuiltInCollision(loaded.id)
      result[loaded.id] = loaded.promptProfile
    }
    return result
  }

  export async function definitions(projectDirectory: string): Promise<Record<string, PromptProfileDefinition>> {
    return {
      ...PromptProfile.builtIns,
      ...(await projectPromptProfiles(projectDirectory)),
    }
  }

  async function definitionsForScope(projectDirectory?: string): Promise<Record<string, PromptProfileDefinition>> {
    if (!projectDirectory) return { ...PromptProfile.builtIns }
    return definitions(projectDirectory)
  }

  export async function overlayFor(input: PromptInput): Promise<string | undefined> {
    const active = PromptProfile.activeID(input.config)
    const profiles = await definitionsForScope(input.projectDirectory)
    const profile = profiles[active]
    if (!profile) {
      throw new Error(`Unknown prompt profile ${JSON.stringify(active)}`)
    }
    const prompt = profile.agents[input.agentID]
    return typeof prompt === "string" && prompt.trim().length > 0 ? prompt : undefined
  }

  export async function composeAgentPrompt(input: ComposeInput): Promise<string> {
    const profilePrompt = await overlayFor(input)
    return [input.base, profilePrompt, input.userAppend]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .join("\n\n")
  }

  export async function assertKnownProfileID(input: ProfileIDInput): Promise<void> {
    PromptProfileIDSchema.parse(input.profileID)
    if (!Object.hasOwn(await definitionsForScope(input.projectDirectory), input.profileID)) {
      throw new Error(`Unknown prompt profile ${JSON.stringify(input.profileID)}`)
    }
  }

  export async function list(input: CatalogInput): Promise<PromptProfileCatalog> {
    const active = PromptProfile.activeID(input.config)
    const projectProfiles = input.projectDirectory ? await projectPromptProfiles(input.projectDirectory) : {}
    const profiles: PromptProfileCatalogProfile[] = [
      ...Object.entries(PromptProfile.builtIns).map(([id, profile]) => ({
        id,
        label: profile.label,
        description: profile.description,
        built_in: true,
        editable: false,
        agents: { ...(profile.agents ?? {}) },
      })),
      ...Object.entries(projectProfiles).map(([id, profile]) => ({
        id,
        label: profile.label,
        description: profile.description,
        built_in: false,
        editable: false,
        agents: { ...(profile.agents ?? {}) },
      })),
    ]
    if (!profiles.some((profile) => profile.id === active)) {
      throw new Error(`Unknown prompt profile ${JSON.stringify(active)}`)
    }
    return PromptProfileCatalogSchema.parse({
      active,
      project_active: input.projectActive ?? active,
      session_active: input.sessionActive ?? null,
      default: DEFAULT_PROMPT_PROFILE_ID,
      targets: PromptProfile.targets,
      profiles,
    })
  }
}
