import { ExpertSquadRegistry } from "@/expert-squad/registry"
import general_expert_squad_jsonc from "./general/expert-squad.jsonc" with { type: "text" }
import general_README_md from "./general/README.md" with { type: "text" }

export const builtInPackageSources = [
  {
    id: "general",
    manifestText: general_expert_squad_jsonc,
    files: {
      "expert-squad.jsonc": general_expert_squad_jsonc,
      "README.md": general_README_md,
    },
  },
] as const

export const loadedBuiltInPackages = builtInPackageSources.map((source) => ExpertSquadRegistry.loadEmbeddedPackage(source))

export const builtInPromptProfiles = Object.fromEntries(
  loadedBuiltInPackages.map((pkg) => [pkg.id, pkg.promptProfile]),
)

export const builtInSelectorSkillSources = loadedBuiltInPackages.flatMap((pkg) => {
  const skill = ExpertSquadRegistry.renderSelectorSkillMarkdown(pkg)
  return skill ? [{ id: `${pkg.id}-expert-squad`, skill, files: {} }] : []
})
