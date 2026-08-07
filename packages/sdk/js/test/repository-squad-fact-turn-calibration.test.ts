// SDK means Software Development Kit; JSON means JavaScript Object Notation.

import { describe, expect, test } from "bun:test"
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import {
  EXPERT_SQUAD_MANIFEST_PATH,
  validateExpertSquadPackageDefinition,
  type ExpertSquadManifestV1,
  type ExpertSquadPackageDefinition,
  type ExpertSquadPackageFile,
} from "../src/expert-squad-authoring"

const repositoryRoot = path.resolve(import.meta.dir, "../../../..")

/** Authoring root shipped as the generated payload; `<namespace>/<id>/...`. */
const AUTHORING_ROOT = "expert-squads"
/** Bundled runtime packages share the same manifest contract. */
const BUILTIN_ROOT = "packages/opencorvus/src/expert-squad/builtin"
/** Version means YYYY.MM.DD.N with a positive daily revision. */
const CANONICAL_VERSION = /^\d{4}\.\d{2}\.\d{2}\.[1-9]\d*$/

const PORTABLE_SCRIPT_COMMANDS_BY_ROOT: Readonly<Record<string, readonly string[]>> = {
  "expert-squads/mirror/prism": [
    "python3 scripts/capture_ui",
    "python3 scripts/capture_ux",
    "bash scripts/web_search",
    "bash scripts/web-read.sh",
  ],
  "expert-squads/tanzeqi/mirror-watch": [
    "python3 scripts/capture_ui",
    "python3 scripts/capture_ux",
    "python3 scripts/s3_upload",
    "bash scripts/web_search",
    "bash scripts/web-read.sh",
  ],
}

/**
 * Every repository-authored package is discovered from the Git index, which is
 * the same authority the payload generator uses. A hand-maintained roster would
 * silently exempt a newly added Squad from this calibration and would go stale
 * on every legitimate version bump.
 */
function discoverRepositorySquadRoots(): string[] {
  const result = Bun.spawnSync({
    cmd: [
      "git",
      "ls-files",
      "--cached",
      "-z",
      "--",
      `${BUILTIN_ROOT}/*/${EXPERT_SQUAD_MANIFEST_PATH}`,
      `${AUTHORING_ROOT}/*/*/${EXPERT_SQUAD_MANIFEST_PATH}`,
    ],
    cwd: repositoryRoot,
    stdout: "pipe",
    stderr: "pipe",
  })
  if (result.exitCode !== 0) {
    throw new Error(
      `Repository Squad discovery could not read the Git index: ${new TextDecoder().decode(result.stderr)}`,
    )
  }
  const roots = new TextDecoder()
    .decode(result.stdout)
    .split("\0")
    .filter(Boolean)
    .map((entry) => path.posix.dirname(entry.replaceAll("\\", "/")))
  if (roots.length === 0) throw new Error("Repository Squad discovery found no authored expert squad packages")
  return [...new Set(roots)].sort()
}

function parseJsonc<T>(source: string): T {
  return JSON.parse(source.replace(/,(\s*[}\]])/g, "$1")) as T
}

async function readPackageFiles(root: string): Promise<Record<string, ExpertSquadPackageFile>> {
  const files: Record<string, ExpertSquadPackageFile> = {}
  const pending = [root]
  while (pending.length > 0) {
    const directory = pending.pop()!
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === ".DS_Store") continue
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        pending.push(absolute)
        continue
      }
      if (!entry.isFile()) continue
      const relative = path.relative(root, absolute).split(path.sep).join("/")
      if (relative === EXPERT_SQUAD_MANIFEST_PATH) continue
      files[relative] = await readFile(absolute)
    }
  }
  return files
}

async function readPackage(
  relativeRoot: string,
): Promise<{ definition: ExpertSquadPackageDefinition; readme: string }> {
  const root = path.join(repositoryRoot, ...relativeRoot.split("/"))
  const manifest = parseJsonc<ExpertSquadManifestV1>(
    await readFile(path.join(root, EXPERT_SQUAD_MANIFEST_PATH), "utf8"),
  )
  return {
    definition: {
      manifest,
      files: await readPackageFiles(root),
    },
    readme: await readFile(path.join(root, manifest.readme), "utf8"),
  }
}

describe("repository Expert Squad fact and Turn calibration", () => {
  test("SDK authoring documentation binds both transports to one canonical publisher", async () => {
    const source = await readFile(path.join(repositoryRoot, "packages/sdk/js/src/expert-squad-authoring.ts"), "utf8")
    expect(source).toContain("payload_json")
    expect(source).toContain("strict JSON text with unique object keys")
    expect(source).toContain("`resources` is required")
    expect(source).toContain("engineArtifacts.publish")
    expect(source).toContain("same canonical publisher")
  })

  for (const root of discoverRepositorySquadRoots()) {
    test(`${root} validates through the SDK and declares the platform fact/Turn boundary`, async () => {
      const { definition, readme } = await readPackage(root)

      expect(validateExpertSquadPackageDefinition(definition)).toBe(definition)
      expect(definition.manifest.id).toBe(path.posix.basename(root))
      expect(definition.manifest.version).toMatch(CANONICAL_VERSION)
      expect(definition.manifest.description.length).toBeGreaterThan(20)
      expect(readme).toContain("## Fact and Turn Contract")
      expect(readme).toContain("visible final assistant message")
      expect(readme).toContain("rather than durable evidence transport")
      expect(readme).toContain("task_completion_decision")
      expect(readme).toContain("Reopen preserves earlier decisions")
      expect(readme).toContain("## Artifact protocol")
      expect(readme).toContain("artifact_search")
      expect(readme).toContain("artifact_read")
      expect(readme).toContain("artifact_snapshot")
      expect(readme).toContain("artifact_publish")
      expect(readme).toContain("resource_refs")
      expect(readme).toContain("payload_json")
      expect(readme).toContain("strict JSON text")
      expect(readme).toContain("object keys must be unique")
      expect(readme).toContain("`resources` is required")
      expect(readme).toContain(
        "Projected workers additionally inherit `artifact_snapshot` and `artifact_publish`; schedulers do not.",
      )
      expect(readme).toContain("<active-squad-id>/")
      expect(readme).toContain("ArtifactReadLocator")
      expect(readme).toContain("import_lineage")
      expect(readme).toContain("{source_task_id, locator}")
      const packageText = Object.entries(definition.files)
        .filter(([file]) => /\.(?:md|txt|jsonc?|ts)$/.test(file))
        .map(
          ([file, content]) => `${file}\n${typeof content === "string" ? content : new TextDecoder().decode(content)}`,
        )
        .join("\n")
      expect(packageText).toContain("payload_json")
      for (const command of PORTABLE_SCRIPT_COMMANDS_BY_ROOT[root] ?? []) {
        expect(packageText).toContain(command)
      }
    })
  }

  test("portable authoring source generates the same contract without a terminal finalizer", async () => {
    const artifactRoot = path.join(repositoryRoot, "specs/artifacts/portable-expert-squad-template")
    const readme = await readFile(path.join(artifactRoot, "README.md"), "utf8")
    const authoringSkill = await readFile(path.join(artifactRoot, "authoring-skill/SKILL.md"), "utf8")
    const { definition, readme: packageReadme } = await readPackage(
      "specs/artifacts/portable-expert-squad-template/package",
    )

    expect(validateExpertSquadPackageDefinition(definition)).toBe(definition)
    expect(definition.manifest.version).toBe("2026.08.01.2")
    expect(readme).toContain("does not add a terminal submit/finalizer protocol")
    expect(authoringSkill).toContain("## Agent fact and Turn contract")
    expect(authoringSkill).toContain(
      "An ordinary package-tool `return string` is only the visible tool result and never publishes an Artifact.",
    )
    expect(authoringSkill).toContain("custom values are exposed only inside `package_metadata`")
    expect(packageReadme).toContain("Each completion atomically appends one typed decision artifact")
    expect(packageReadme).toContain("A plain package-tool return never creates an Artifact.")
    expect(readme).toContain("ArtifactReadLocator")
    expect(readme).toContain("import_lineage")
    expect(readme).toContain("artifact_snapshot")
    expect(readme).toContain("artifact_publish")
    expect(readme).toContain("resource_refs")
    expect(readme).toContain("payload_json")
    expect(readme).toContain("strict JSON text")
    expect(readme).toContain("object keys must be unique")
    expect(readme).toContain("`resources` is required")
    expect(readme).toContain(
      "Projected workers additionally receive `artifact_snapshot` and `artifact_publish`; schedulers do not.",
    )
    expect(authoringSkill).toContain("ArtifactReadLocator")
    expect(authoringSkill).toContain("import_lineage")
    expect(authoringSkill).not.toContain(["opencorvus", "cross-task-import"].join("/"))
    expect(authoringSkill).toContain("artifact_snapshot")
    expect(authoringSkill).toContain("artifact_publish")
    expect(authoringSkill).toContain("resource_refs")
    expect(authoringSkill).toContain("payload_json")
    expect(authoringSkill).toContain("strict JSON text")
    expect(authoringSkill).toContain("unique object keys")
    expect(authoringSkill).toContain("`resources` is required")
    expect(authoringSkill).toContain(
      "Projected workers additionally receive `artifact_snapshot` and `artifact_publish`; schedulers do not.",
    )
    expect(packageReadme).toContain("ArtifactReadLocator")
    expect(packageReadme).toContain("import_lineage")
    expect(packageReadme).not.toContain(["opencorvus", "cross-task-import"].join("/"))
    expect(packageReadme).toContain("artifact_snapshot")
    expect(packageReadme).toContain("artifact_publish")
    expect(packageReadme).toContain("resource_refs")
    expect(packageReadme).toContain("payload_json")
    expect(packageReadme).toContain("strict JSON text")
    expect(packageReadme).toContain("object keys must be unique")
    expect(packageReadme).toContain("`resources` is required")
    expect(packageReadme).toContain(
      "projected workers additionally receive `artifact_snapshot` and `artifact_publish`, while schedulers do not",
    )
    const portableText = [readme, authoringSkill, packageReadme, ...Object.values(definition.files)]
      .map((content) => (typeof content === "string" ? content : new TextDecoder().decode(content)))
      .join("\n")
    const reconciliationPolicyTool = definition.files["tools/reconciliation-policy.ts"]
    if (reconciliationPolicyTool === undefined) throw new Error("portable reconciliation policy tool is missing")
    expect(
      typeof reconciliationPolicyTool === "string"
        ? reconciliationPolicyTool
        : new TextDecoder().decode(reconciliationPolicyTool),
    ).toContain("context.host.engineArtifacts.publish")
    expect(portableText).not.toMatch(
      /SubAgentProtocol|renderFactReferences|domain_artifact_refs|artifact_ids|artifact_id|requirement_set_artifact_id|evidence_refs|artifact:/,
    )
    expect(packageReadme).not.toContain("acceptance candidate")
    expect(readme).not.toContain("finalizer template")
  })
})
