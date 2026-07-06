import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { catalogSummaryFromPackage } from "../../src/expert-squad/catalog-profile"
import { ExpertSquadRegistry } from "../../src/expert-squad/registry"
import { tmpdir } from "../fixture/fixture"
import { PROJECT_EXPERT_SQUAD_ID, writeProjectExpertSquadPackage } from "../fixture/expert-squad"

async function packageInput(displayPrefix?: string) {
  await using project = await tmpdir({ git: true })
  const packageRoot = await writeProjectExpertSquadPackage(project.path, PROJECT_EXPERT_SQUAD_ID)
  if (displayPrefix) {
    await fs.writeFile(
      path.join(packageRoot, "README.md"),
      `---\nexpert_squad_display_prefix: ${displayPrefix}\n---\n\n# Project Replica\n`,
    )
  }
  return ExpertSquadRegistry.loadPackage(packageRoot)
}

describe("expert squad catalog display prefix", () => {
  test("uses package-owned display prefix only for display label derivation", async () => {
    const summary = catalogSummaryFromPackage({
      id: PROJECT_EXPERT_SQUAD_ID,
      pkg: await packageInput("Partner"),
      builtIn: false,
    })

    expect(summary).toMatchObject({
      id: PROJECT_EXPERT_SQUAD_ID,
      label: "Project Replica",
      display_prefix: "Partner",
      display_label: "Partner/Project Replica",
      source: { kind: "project_package" },
    })
  })

  test("keeps unprefixed packages unprefixed", async () => {
    const summary = catalogSummaryFromPackage({
      id: PROJECT_EXPERT_SQUAD_ID,
      pkg: await packageInput(),
      builtIn: false,
    })

    expect(summary.display_prefix).toBeUndefined()
    expect(summary.display_label).toBe("Project Replica")
  })
})
