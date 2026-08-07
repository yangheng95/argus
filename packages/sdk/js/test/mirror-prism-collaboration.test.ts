// SDK means Software Development Kit.

import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import path from "node:path"
import {
  validateExpertSquadSourceCapabilities,
  type ExpertSquadManifestV1,
  type ExpertSquadSourceCapabilityContract,
} from "../src/expert-squad-authoring"

const repositoryRoot = path.resolve(import.meta.dir, "../../../..")
const packageManifestPaths = [
  "expert-squads/mirror/prism/expert-squad.jsonc",
  "expert-squads/builtin/review-debug/expert-squad.jsonc",
  "expert-squads/wujiang/opentest/expert-squad.jsonc",
] as const

function parseJsonc<T>(source: string): T {
  return JSON.parse(source.replace(/,(\s*[}\]])/g, "$1")) as T
}

async function repositoryFile(relativePath: string): Promise<string> {
  return readFile(path.join(repositoryRoot, ...relativePath.split("/")), "utf8")
}

describe("Mirror Prism package authoring contract", () => {
  test("assigns initial repository observation to the selected workflow worker", async () => {
    const [systemPrompt, coordinationSkill] = await Promise.all([
      repositoryFile("expert-squads/mirror/prism/agents/orchestrator/system.md"),
      repositoryFile("expert-squads/mirror/prism/agents/orchestrator/skills/prism-delivery-coordination/SKILL.md"),
    ])

    for (const contract of [systemPrompt, coordinationSkill]) {
      expect(contract).toContain("immediately dispatch")
      expect(contract).toContain("greenfield_original")
      expect(contract).toContain("Frontend Replica Expert Squad")
      expect(contract).toContain("mirror-prd-stage-planner")
      expect(contract).toContain("subsystem_closure")
      expect(contract).toContain("associated subpage")
    }
  })

  test("validates the repository source-capability contract against package owners", async () => {
    const [contract, ...manifests] = await Promise.all([
      repositoryFile("specs/artifacts/mirror-prism/source-capability-contract.json").then(
        (source) => JSON.parse(source) as ExpertSquadSourceCapabilityContract,
      ),
      ...packageManifestPaths.map(async (manifestPath) =>
        parseJsonc<ExpertSquadManifestV1>(await repositoryFile(manifestPath)),
      ),
    ])

    expect(validateExpertSquadSourceCapabilities({ definition: contract, collaborations: [], manifests })).toBe(
      contract,
    )
    expect(contract.pipeline_groups.flatMap((group) => group.source_steps)).toHaveLength(20)
  })
})
