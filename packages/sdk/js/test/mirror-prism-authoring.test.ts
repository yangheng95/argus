// SDK means Software Development Kit.

import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  EXPERT_SQUAD_MANIFEST_PATH,
  writeExpertSquadPackage,
  type ExpertSquadManifestV1,
  type ExpertSquadPackageDefinition,
} from "../src/expert-squad-authoring"

const repositoryRoot = path.resolve(import.meta.dir, "../../../..")
const packageRoot = path.join(repositoryRoot, "expert-squads", "mirror", "prism")

function parseJsonc<T>(source: string): T {
  return JSON.parse(source.replace(/,(\s*[}\]])/g, "$1")) as T
}

async function packageFiles(root: string): Promise<string[]> {
  const files: string[] = []
  const pending = [root]
  while (pending.length > 0) {
    const directory = pending.pop()!
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) pending.push(absolute)
      else if (entry.isFile()) files.push(path.relative(root, absolute).replaceAll("\\", "/"))
    }
  }
  return files.sort()
}

describe("Mirror Prism Expert Squad authoring", () => {
  test("exports the canonical package manifest path", () => {
    expect(EXPERT_SQUAD_MANIFEST_PATH).toBe("expert-squad.jsonc")
  })

  test("round-trips the complete self-contained package without changing caller-owned bytes", async () => {
    const sourceFiles = await packageFiles(packageRoot)
    const manifest = parseJsonc<ExpertSquadManifestV1>(
      await readFile(path.join(packageRoot, EXPERT_SQUAD_MANIFEST_PATH), "utf8"),
    )
    const files = Object.fromEntries(
      await Promise.all(
        sourceFiles
          .filter((relativePath) => relativePath !== EXPERT_SQUAD_MANIFEST_PATH)
          .map(async (relativePath) => [relativePath, await readFile(path.join(packageRoot, relativePath))] as const),
      ),
    ) satisfies ExpertSquadPackageDefinition["files"]
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "prism-sdk-authoring-"))
    const output = path.join(temporaryRoot, "prism")
    try {
      const result = await writeExpertSquadPackage({ directory: output, definition: { manifest, files } })
      expect(result.files.sort()).toEqual(sourceFiles)
      expect(await packageFiles(output)).toEqual(sourceFiles)
      expect(JSON.parse(await readFile(path.join(output, EXPERT_SQUAD_MANIFEST_PATH), "utf8"))).toEqual(manifest)
      expect(manifest).toMatchObject({
        schema_version: 1,
        namespace: "mirror",
        id: "prism",
        version: "2026.08.03.5",
      })
      expect(sourceFiles).toEqual(
        expect.arrayContaining([
          "lib/mirror-watch/source-observation.ts",
          "tools/publish-competitor-research.ts",
        ]),
      )
      expect(Object.keys(manifest.capability_projection.agents)).toHaveLength(18)
      expect(Object.keys(manifest.capability_projection.virtual_workflows)).toEqual(["mirror-prism-ainvest"])
      for (const relativePath of sourceFiles.filter((entry) => entry !== EXPERT_SQUAD_MANIFEST_PATH)) {
        expect(
          Buffer.compare(
            await readFile(path.join(output, relativePath)),
            await readFile(path.join(packageRoot, relativePath)),
          ),
          relativePath,
        ).toBe(0)
      }
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  })
})
