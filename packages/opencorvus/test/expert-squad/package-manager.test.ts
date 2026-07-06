import { BlobReader, TextReader, TextWriter, Uint8ArrayWriter, ZipReader, ZipWriter } from "@zip.js/zip.js"
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { ExpertSquadPackageManager } from "../../src/expert-squad/manager"
import { payloadPackageSources } from "../../src/expert-squad/payload"
import { ExpertSquadRegistry } from "../../src/expert-squad/registry"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { resetDatabase } from "../fixture/db"
import { repositoryExpertSquadRoot } from "../fixture/expert-squad"
import { tmpdir } from "../fixture/fixture"

const PACKAGE_ID = "custom-replica"

async function writeFile(root: string, relativePath: string, content: string) {
  const target = path.join(root, relativePath)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, content)
}

async function readJsonFile(file: string) {
  return JSON.parse(await fs.readFile(file, "utf8"))
}

async function collectRelativeFiles(root: string): Promise<string[]> {
  const files: string[] = []
  async function walk(current: string) {
    const entries = (await fs.readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const child = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(child)
        continue
      }
      if (entry.isFile()) files.push(path.relative(root, child).replace(/\\/g, "/"))
    }
  }
  await walk(root)
  return files
}

async function writePromptProfileConfig(projectRoot: string) {
  const value = {
    prompt_profile: {
      active: "general",
    },
  }
  const file = path.join(projectRoot, "opencorvus.json")
  await fs.writeFile(file, JSON.stringify(value, null, 2))
  return { file, value }
}

async function writeIntegrityOwnedWorkflowConfig(projectRoot: string) {
  const value = {
    prompt_profile: {
      active: "general",
    },
    assistant: {
      workflows: [
        {
          id: "custom-owner-map",
          name: "Custom owner map",
          description: "Test workflow that binds build tool ownership to integrity.",
          steps: [
            {
              id: "integrity-owned-build",
              tool: "build",
              agentRole: "integrity",
              label: "Integrity-owned build",
              hint: "Test only.",
              scope: "goal",
              skippable: false,
              after: [],
            },
          ],
          goalLoopStepIDs: ["integrity-owned-build"],
        },
      ],
    },
  }
  const file = path.join(projectRoot, "opencorvus.json")
  await fs.writeFile(file, JSON.stringify(value, null, 2))
  return { file, value }
}

function manifest(overrides: Record<string, unknown> = {}) {
  const id = typeof overrides.id === "string" ? overrides.id : PACKAGE_ID
  return {
    schema_version: 1,
    id,
    label: "Frontend Replica",
    description: "Replica squad",
    version: "2026.07.03",
    readme: "README.md",
    selector: {
      summary: "Use for replica tasks.",
      selection_guidance: `Call select_expert_squad with profile_id ${id}.`,
      instructions: "selector.md",
    },
    capability_projection: {
      scheduler: {
        role_base: true,
        built_in_tool_ids: ["select_expert_squad", "skill", "build"],
        package_tool_refs: [`${id}/orchestrator/source-evidence`],
        package_skill_refs: [`${id}/orchestrator/scheduler`],
      },
      agents: {
        build: {
          role_base: true,
          package_skill_refs: [`${id}/build/implementation`],
          package_tool_refs: [`${id}/build/build-evidence`],
        },
      },
    },
    agents: {
      general: {
        prompt: "agents/general/system.md",
      },
      orchestrator: {
        prompt: "agents/orchestrator/system.md",
        skill_refs: [`${id}/orchestrator/scheduler`],
        tool_refs: [`${id}/orchestrator/source-evidence`],
      },
      build: {
        prompt: "agents/build/system.md",
        skill_refs: [`${id}/build/implementation`],
        tool_refs: [`${id}/build/build-evidence`],
      },
    },
    ...overrides,
  }
}

function packageFileMap(prefix = "", overrides: Record<string, string> = {}) {
  const root = prefix ? `${prefix.replace(/\/+$/, "")}/` : ""
  return {
    [`${root}README.md`]: "# Frontend Replica\n",
    [`${root}selector.md`]: "# Frontend Replica Selector\n\nUse explicit selector instructions from this file.\n",
    [`${root}agents/general/system.md`]: "general overlay",
    [`${root}agents/orchestrator/system.md`]: "orchestrator overlay",
    [`${root}agents/build/system.md`]: "build overlay",
    [`${root}agents/orchestrator/skills/scheduler/SKILL.md`]: "---\nname: scheduler\n---\n",
    [`${root}agents/build/skills/implementation/SKILL.md`]: "---\nname: implementation\n---\n",
    [`${root}agents/orchestrator/tools/source-evidence.ts`]: "export default {}",
    [`${root}agents/build/tools/build-evidence.ts`]: "export default {}",
    [`${root}${ExpertSquadRegistry.MANIFEST}`]: JSON.stringify(manifest(), null, 2),
    ...overrides,
  }
}

async function writeSourcePackage(root: string, folder = "uploaded-folder", overrides: Record<string, string> = {}) {
  const packageRoot = path.join(root, folder)
  for (const [relativePath, content] of Object.entries(packageFileMap("", overrides))) {
    await writeFile(packageRoot, relativePath, content)
  }
  return packageRoot
}

async function zipBase64(entries: Array<[string, string]>) {
  const writer = new ZipWriter(new Uint8ArrayWriter())
  for (const [name, content] of entries) await writer.add(name, new TextReader(content))
  return Buffer.from(await writer.close()).toString("base64")
}

async function zipEntries(bytes: Uint8Array): Promise<Map<string, string>> {
  const reader = new ZipReader(new BlobReader(new Blob([bytes])))
  try {
    const entries = await reader.getEntries()
    const result = new Map<string, string>()
    for (const entry of entries) {
      if (entry.directory || !entry.getData) continue
      result.set(entry.filename, await entry.getData(new TextWriter()))
    }
    return result
  } finally {
    await reader.close()
  }
}

describe("ExpertSquadPackageManager", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("payload package sources match current repository expert-squad packages", async () => {
    expect(payloadPackageSources.map((source) => source.id)).toEqual([
      "algorithm",
      "backend",
      "frontend-automation-debug",
      "frontend-innovate",
      "frontend-replica",
      "software-testing",
    ])

    for (const source of payloadPackageSources) {
      expect(ExpertSquadRegistry.loadEmbeddedPackage(source).id).toBe(source.id)
      const repositoryRoot = repositoryExpertSquadRoot(source.id)
      const repositoryFiles = await collectRelativeFiles(repositoryRoot)
      expect(new Set(Object.keys(source.files))).toEqual(new Set(repositoryFiles))
      for (const relativePath of repositoryFiles) {
        expect(source.files[relativePath]).toBe(await fs.readFile(path.join(repositoryRoot, relativePath), "utf8"))
      }
    }
  })

  test("software-testing payload exposes one external OpenTest protocol engine source", () => {
    const source = payloadPackageSources.find((candidate) => candidate.id === "software-testing")
    expect(source).toBeDefined()
    expect(Object.keys(source!.files)).toContain("protocol-engine/opentest-contract.json")
    expect(Object.keys(source!.files)).toContain("protocol-engine/opentest-protocol-engine.ts")
    expect(Object.keys(source!.files)).toContain("tools/opentest-protocol-engine.ts")
    expect(Object.keys(source!.files)).not.toContain("tools/test-protocol-contract.ts")
    expect(source!.files["tools/opentest-protocol-engine.ts"]).toContain("parseProtocolContract(contractText)")
    expect(source!.files["protocol-engine/opentest-protocol-engine.ts"]).toContain("export function parseProtocolContract")
    expect(source!.files["protocol-engine/opentest-protocol-engine.ts"]).not.toContain("const OPEN_TEST_PROTOCOL")
  })

  test("rejects payload package sources with unsafe embedded file paths", () => {
    const source = payloadPackageSources[0]!
    for (const relativePath of ["../escape.txt", "nested/../escape.txt", "C:/escape.txt", "README.md:ads", ""]) {
      expect(() =>
        ExpertSquadPackageManager.validatePayloadPackageSource({
          ...source,
          files: {
            ...source.files,
            [relativePath]: "unsafe payload content",
          },
        }),
      ).toThrow(/expert squad payload path/)
    }
  })

  test("releases payload packages into an empty project without overwriting existing packages", async () => {
    await using project = await tmpdir({ git: true })

    const first = await ExpertSquadPackageManager.releasePayloadPackages({ projectDirectory: project.path })

    expect(first.installed.map((item) => item.id)).toEqual(payloadPackageSources.map((source) => source.id))
    expect(first.skipped).toEqual([])
    for (const source of payloadPackageSources) {
      const targetRoot = path.join(project.path, ".opencorvus", "expert-squads", source.id)
      await expect(ExpertSquadRegistry.loadPackage(targetRoot)).resolves.toMatchObject({ id: source.id })
    }

    await writeFile(
      path.join(project.path, ".opencorvus", "expert-squads", "frontend-replica"),
      "README.md",
      "# Project-owned Frontend Replica\n",
    )
    const second = await ExpertSquadPackageManager.releasePayloadPackages({ projectDirectory: project.path })

    expect(second.installed).toEqual([])
    expect(second.skipped.map((item) => item.id)).toEqual(payloadPackageSources.map((source) => source.id))
    expect(
      await fs.readFile(path.join(project.path, ".opencorvus", "expert-squads", "frontend-replica", "README.md"), "utf8"),
    ).toBe("# Project-owned Frontend Replica\n")
  })

  test("payload release rejects existing non-directory targets", async () => {
    await using project = await tmpdir({ git: true })
    const targetRoot = path.join(project.path, ".opencorvus", "expert-squads", "algorithm")
    await fs.mkdir(path.dirname(targetRoot), { recursive: true })
    await fs.writeFile(targetRoot, "not a package directory")

    await expect(ExpertSquadPackageManager.releasePayloadPackages({ projectDirectory: project.path })).rejects.toThrow(
      `Expert squad target exists and is not a directory: ${targetRoot}`,
    )
  })

  test("failed payload post-move validation removes the newly released target", async () => {
    await using project = await tmpdir({ git: true })
    const targetRoot = path.join(project.path, ".opencorvus", "expert-squads", "algorithm")
    const originalLoadPackage = ExpertSquadRegistry.loadPackage
    spyOn(ExpertSquadRegistry, "loadPackage").mockImplementation(async (...args) => {
      const [root] = args
      if (path.normalize(root) === path.normalize(targetRoot)) {
        throw new Error("forced payload post-move validation failure")
      }
      return originalLoadPackage(...args)
    })

    await expect(ExpertSquadPackageManager.releasePayloadPackages({ projectDirectory: project.path })).rejects.toThrow(
      "forced payload post-move validation failure",
    )
    await expect(fs.lstat(targetRoot)).rejects.toMatchObject({ code: "ENOENT" })
  })

  test("imports a source folder into the canonical expert-squad directory without selecting it", async () => {
    await using project = await tmpdir({ git: true })
    await using source = await tmpdir()
    const sourceRoot = await writeSourcePackage(source.path, "arbitrary-upload-name")
    const projectConfig = await writePromptProfileConfig(project.path)
    const sessionOverlay = { prompt_profile: { active: "general" } } as const

    const imported = await Instance.provide({
      directory: project.path,
      fn: async () => {
        const rootSession = await Session.create({ kind: "root", title: "expert squad import root" })
        await Session.mergeConfigOverlay({ sessionID: rootSession.id, patch: sessionOverlay })
        const overlayBefore = (await Session.get(rootSession.id)).metadata?.configOverlay
        const result = await ExpertSquadPackageManager.importDirectory({
          projectDirectory: project.path,
          sourceDirectory: sourceRoot,
          replace: false,
        })
        expect((await Session.get(rootSession.id)).metadata?.configOverlay).toEqual(overlayBefore)
        return result
      },
    })

    const targetRoot = path.join(project.path, ".opencorvus", "expert-squads", PACKAGE_ID)
    expect(imported).toEqual({ id: PACKAGE_ID, targetRoot, replaced: false })
    expect(await fs.readFile(path.join(targetRoot, "README.md"), "utf8")).toContain("Frontend Replica")
    expect(await fs.readFile(path.join(targetRoot, "agents", "general", "system.md"), "utf8")).toContain("general overlay")
    await expect(ExpertSquadRegistry.loadPackage(targetRoot)).resolves.toMatchObject({ id: PACKAGE_ID })
    expect(await readJsonFile(projectConfig.file)).toEqual(projectConfig.value)
    expect(await ExpertSquadRegistry.discover(project.path)).toHaveLength(1)
  })

  test("imports and exports packages using active project workflow bindings", async () => {
    await using project = await tmpdir({ git: true })
    await using source = await tmpdir()
    await writeIntegrityOwnedWorkflowConfig(project.path)
    const sourceRoot = await writeSourcePackage(source.path, "integrity-owned-upload")
    const sourceManifest = manifest({
      capability_projection: {
        scheduler: {
          role_base: true,
          built_in_tool_ids: ["select_expert_squad", "skill", "build"],
          package_tool_refs: [`${PACKAGE_ID}/orchestrator/source-evidence`],
          package_skill_refs: [`${PACKAGE_ID}/orchestrator/scheduler`],
        },
        agents: {
          integrity: {
            role_base: true,
          },
        },
      },
      agents: {
        orchestrator: {
          prompt: "agents/orchestrator/system.md",
          skill_refs: [`${PACKAGE_ID}/orchestrator/scheduler`],
          tool_refs: [`${PACKAGE_ID}/orchestrator/source-evidence`],
        },
        integrity: {
          prompt: "agents/integrity/system.md",
        },
      },
    })
    await fs.rm(path.join(sourceRoot, "agents", "build"), { recursive: true, force: true })
    await writeFile(sourceRoot, "agents/integrity/system.md", "integrity overlay")
    await writeFile(sourceRoot, ExpertSquadRegistry.MANIFEST, JSON.stringify(sourceManifest, null, 2))

    const imported = await ExpertSquadPackageManager.importDirectory({
      projectDirectory: project.path,
      sourceDirectory: sourceRoot,
      replace: false,
    })
    expect(imported.id).toBe(PACKAGE_ID)

    const exported = await ExpertSquadPackageManager.exportArchive({ projectDirectory: project.path, id: PACKAGE_ID })
    expect(exported.id).toBe(PACKAGE_ID)
    const entries = await zipEntries(exported.bytes)
    expect(entries.has(`${PACKAGE_ID}/agents/integrity/system.md`)).toBe(true)
  })

  test("imports packages using workflow config discovered from OPENCORVUS_CONFIG_DIR", async () => {
    await using project = await tmpdir({ git: true })
    await using configDir = await tmpdir()
    await using source = await tmpdir()
    await writeIntegrityOwnedWorkflowConfig(configDir.path)
    const sourceRoot = await writeSourcePackage(source.path, "parent-config-owned-upload")
    const sourceManifest = manifest({
      capability_projection: {
        scheduler: {
          role_base: true,
          built_in_tool_ids: ["select_expert_squad", "skill", "build"],
          package_tool_refs: [`${PACKAGE_ID}/orchestrator/source-evidence`],
          package_skill_refs: [`${PACKAGE_ID}/orchestrator/scheduler`],
        },
        agents: {
          integrity: {
            role_base: true,
          },
        },
      },
      agents: {
        orchestrator: {
          prompt: "agents/orchestrator/system.md",
          skill_refs: [`${PACKAGE_ID}/orchestrator/scheduler`],
          tool_refs: [`${PACKAGE_ID}/orchestrator/source-evidence`],
        },
        integrity: {
          prompt: "agents/integrity/system.md",
        },
      },
    })
    await fs.rm(path.join(sourceRoot, "agents", "build"), { recursive: true, force: true })
    await writeFile(sourceRoot, "agents/integrity/system.md", "integrity overlay")
    await writeFile(sourceRoot, ExpertSquadRegistry.MANIFEST, JSON.stringify(sourceManifest, null, 2))
    await expect(fs.lstat(path.join(project.path, ".gitignore"))).rejects.toMatchObject({ code: "ENOENT" })

    const previousConfigDir = process.env.OPENCORVUS_CONFIG_DIR
    process.env.OPENCORVUS_CONFIG_DIR = configDir.path
    let imported: ExpertSquadPackageManager.ImportResult
    try {
      imported = await ExpertSquadPackageManager.importDirectory({
        projectDirectory: project.path,
        sourceDirectory: sourceRoot,
        replace: false,
      })
    } finally {
      if (previousConfigDir === undefined) delete process.env.OPENCORVUS_CONFIG_DIR
      else process.env.OPENCORVUS_CONFIG_DIR = previousConfigDir
    }

    expect(imported.id).toBe(PACKAGE_ID)
    expect(imported.targetRoot).toBe(path.join(project.path, ".opencorvus", "expert-squads", PACKAGE_ID))
    await expect(fs.lstat(path.join(project.path, ".gitignore"))).rejects.toMatchObject({ code: "ENOENT" })
  })

  test("imports a ZIP archive with an arbitrary wrapper folder", async () => {
    await using project = await tmpdir()
    const projectConfig = await writePromptProfileConfig(project.path)
    const archiveBase64 = await zipBase64(Object.entries(packageFileMap("downloaded-name")))

    const imported = await ExpertSquadPackageManager.importArchive({
      projectDirectory: project.path,
      archiveBase64,
      filename: "similar-display-name.zip",
      replace: false,
    })

    expect(imported.id).toBe(PACKAGE_ID)
    expect(imported.targetRoot).toBe(path.join(project.path, ".opencorvus", "expert-squads", PACKAGE_ID))
    expect(await readJsonFile(projectConfig.file)).toEqual(projectConfig.value)
  })

  test("rejects package IDs that collide with built-in expert squads", async () => {
    await using project = await tmpdir()
    await using source = await tmpdir()
    const sourceRoot = await writeSourcePackage(source.path, "built-in-collision", {
      [ExpertSquadRegistry.MANIFEST]: JSON.stringify(manifest({ id: "general" }), null, 2),
    })

    await expect(
      ExpertSquadPackageManager.importDirectory({ projectDirectory: project.path, sourceDirectory: sourceRoot, replace: false }),
    ).rejects.toThrow(/collides with a built-in expert squad id/)
    await expect(fs.lstat(path.join(project.path, ".opencorvus", "expert-squads", "general"))).rejects.toMatchObject({
      code: "ENOENT",
    })
  })

  test("rejects existing packages unless replace is explicit", async () => {
    await using project = await tmpdir()
    await using source = await tmpdir()
    const sourceRoot = await writeSourcePackage(source.path)
    await ExpertSquadPackageManager.importDirectory({ projectDirectory: project.path, sourceDirectory: sourceRoot, replace: false })

    await expect(
      ExpertSquadPackageManager.importDirectory({ projectDirectory: project.path, sourceDirectory: sourceRoot, replace: false }),
    ).rejects.toThrow(/already exists/)

    await writeFile(sourceRoot, "README.md", "# Frontend Replica Replacement\n")
    const replaced = await ExpertSquadPackageManager.importDirectory({
      projectDirectory: project.path,
      sourceDirectory: sourceRoot,
      replace: true,
    })

    expect(replaced.replaced).toBe(true)
    expect(await fs.readFile(path.join(replaced.targetRoot, "README.md"), "utf8")).toContain("Replacement")
  })

  test("serializes concurrent replace operations for one manifest ID", async () => {
    await using project = await tmpdir()
    await using initial = await tmpdir()
    const initialRoot = await writeSourcePackage(initial.path, "initial")
    const first = await ExpertSquadPackageManager.importDirectory({
      projectDirectory: project.path,
      sourceDirectory: initialRoot,
      replace: false,
    })
    const replacementRoots: string[] = []
    for (let index = 0; index < 6; index++) {
      await using replacement = await tmpdir()
      const root = await writeSourcePackage(replacement.path, `replacement-${index}`)
      await writeFile(root, "README.md", `# Replacement ${index}\n`)
      replacementRoots.push(root)
    }

    const results = await Promise.all(
      replacementRoots.map((sourceDirectory) =>
        ExpertSquadPackageManager.importDirectory({
          projectDirectory: project.path,
          sourceDirectory,
          replace: true,
        }),
      ),
    )

    expect(results).toHaveLength(replacementRoots.length)
    expect(results.every((result) => result.replaced)).toBe(true)
    await expect(ExpertSquadRegistry.loadPackage(first.targetRoot)).resolves.toMatchObject({ id: PACKAGE_ID })
    expect(await ExpertSquadRegistry.discover(project.path)).toHaveLength(1)
    expect(await fs.readFile(path.join(first.targetRoot, "README.md"), "utf8")).toMatch(/^# Replacement \d\n$/)
  })

  test("rejects source packages from OpenCorvus runtime storage", async () => {
    await using project = await tmpdir()
    const sourceRoot = await writeSourcePackage(path.join(project.path, ".opencorvus", "r"), "runtime-package")

    await expect(
      ExpertSquadPackageManager.importDirectory({ projectDirectory: project.path, sourceDirectory: sourceRoot, replace: false }),
    ).rejects.toThrow(/inside OpenCorvus runtime storage/)
  })

  test("rejects target paths that are not package directories", async () => {
    await using project = await tmpdir()
    await using source = await tmpdir()
    const sourceRoot = await writeSourcePackage(source.path)
    await writeFile(project.path, `.opencorvus/expert-squads/${PACKAGE_ID}`, "not a directory")

    await expect(
      ExpertSquadPackageManager.importDirectory({ projectDirectory: project.path, sourceDirectory: sourceRoot, replace: true }),
    ).rejects.toThrow(/not a directory/)
  })

  test("failed replacement leaves the installed package intact", async () => {
    await using project = await tmpdir()
    await using source = await tmpdir()
    const sourceRoot = await writeSourcePackage(source.path)
    const imported = await ExpertSquadPackageManager.importDirectory({
      projectDirectory: project.path,
      sourceDirectory: sourceRoot,
      replace: false,
    })
    await writeFile(sourceRoot, "README.md", "# Broken Replacement\n")
    await fs.rm(path.join(sourceRoot, "agents", "build", "tools", "build-evidence.ts"))

    await expect(
      ExpertSquadPackageManager.importDirectory({ projectDirectory: project.path, sourceDirectory: sourceRoot, replace: true }),
    ).rejects.toThrow(/not declared in this package/)

    expect(await fs.readFile(path.join(imported.targetRoot, "README.md"), "utf8")).toContain("Frontend Replica")
    await expect(ExpertSquadRegistry.loadPackage(imported.targetRoot)).resolves.toMatchObject({ id: PACKAGE_ID })
  })

  test("failed replacement after moving the new target restores the previous package", async () => {
    await using project = await tmpdir()
    await using source = await tmpdir()
    const sourceRoot = await writeSourcePackage(source.path)
    const imported = await ExpertSquadPackageManager.importDirectory({
      projectDirectory: project.path,
      sourceDirectory: sourceRoot,
      replace: false,
    })
    await writeFile(sourceRoot, "README.md", "# Broken Replacement After Move\n")
    const originalLoadPackage = ExpertSquadRegistry.loadPackage
    const loadPackage = spyOn(ExpertSquadRegistry, "loadPackage").mockImplementation(async (root) => {
      if (path.resolve(root) === path.resolve(imported.targetRoot)) throw new Error("post-move replacement validation failed")
      return originalLoadPackage(root)
    })

    await expect(
      ExpertSquadPackageManager.importDirectory({ projectDirectory: project.path, sourceDirectory: sourceRoot, replace: true }),
    ).rejects.toThrow(/post-move replacement validation failed/)

    loadPackage.mockRestore()
    expect(await fs.readFile(path.join(imported.targetRoot, "README.md"), "utf8")).toContain("Frontend Replica")
    await expect(ExpertSquadRegistry.loadPackage(imported.targetRoot)).resolves.toMatchObject({ id: PACKAGE_ID })
  })

  test("failed first install removes the newly moved target", async () => {
    await using project = await tmpdir()
    await using source = await tmpdir()
    const sourceRoot = await writeSourcePackage(source.path)
    const targetRoot = path.join(project.path, ".opencorvus", "expert-squads", PACKAGE_ID)
    const originalLoadPackage = ExpertSquadRegistry.loadPackage
    spyOn(ExpertSquadRegistry, "loadPackage").mockImplementation(async (root) => {
      if (path.resolve(root) === path.resolve(targetRoot)) throw new Error("post-move validation failed")
      return originalLoadPackage(root)
    })

    await expect(
      ExpertSquadPackageManager.importDirectory({ projectDirectory: project.path, sourceDirectory: sourceRoot, replace: false }),
    ).rejects.toThrow(/post-move validation failed/)

    await expect(fs.lstat(targetRoot)).rejects.toMatchObject({ code: "ENOENT" })
  })

  test("rejects source packages whose manifest id changes during staging", async () => {
    await using project = await tmpdir()
    await using source = await tmpdir()
    const sourceRoot = await writeSourcePackage(source.path)
    const targetRoot = path.join(project.path, ".opencorvus", "expert-squads", PACKAGE_ID)
    const originalLoadSourcePackage = ExpertSquadRegistry.loadSourcePackage
    let loadCount = 0
    spyOn(ExpertSquadRegistry, "loadSourcePackage").mockImplementation(async (root) => {
      const loaded = await originalLoadSourcePackage(root)
      loadCount += 1
      return loadCount === 2 ? { ...loaded, id: "frontend-innovate" } : loaded
    })

    await expect(
      ExpertSquadPackageManager.importDirectory({ projectDirectory: project.path, sourceDirectory: sourceRoot, replace: false }),
    ).rejects.toThrow(/id changed during import/)

    expect(loadCount).toBe(2)
    await expect(fs.lstat(targetRoot)).rejects.toMatchObject({ code: "ENOENT" })
  })

  test("rejects ZIP archives that exceed import resource limits", async () => {
    await using project = await tmpdir()
    const extraEntryCount = ExpertSquadPackageManager.archiveImportLimits.entries + 1
    const manyEntries = await zipBase64([
      ...Object.entries(packageFileMap("pkg")),
      ...Array.from({ length: extraEntryCount }, (_, index) => [`pkg/agents/build/skills/extra-${index}/SKILL.md`, "x"] as const),
    ])
    await expect(
      ExpertSquadPackageManager.importArchive({ projectDirectory: project.path, archiveBase64: manyEntries, replace: false }),
    ).rejects.toThrow(/entry count exceeds limit/)

    const oversizedFile = "x".repeat(ExpertSquadPackageManager.archiveImportLimits.fileBytes + 1)
    const oversizedArchive = await zipBase64([
      ...Object.entries(packageFileMap("pkg")),
      ["pkg/agents/build/skills/implementation/large.md", oversizedFile],
    ])
    await expect(
      ExpertSquadPackageManager.importArchive({ projectDirectory: project.path, archiveBase64: oversizedArchive, replace: false }),
    ).rejects.toThrow(/archive file .* exceeds expert squad archive limit/)

    const chunk = "x".repeat(Math.floor(ExpertSquadPackageManager.archiveImportLimits.fileBytes / 2))
    const chunkCount = Math.floor(ExpertSquadPackageManager.archiveImportLimits.totalUnpackedBytes / chunk.length) + 1
    const totalOversizedArchive = await zipBase64([
      ...Object.entries(packageFileMap("pkg")),
      ...Array.from({ length: chunkCount }, (_, index) => [`pkg/agents/build/skills/bulk-${index}/SKILL.md`, chunk] as const),
    ])
    await expect(
      ExpertSquadPackageManager.importArchive({ projectDirectory: project.path, archiveBase64: totalOversizedArchive, replace: false }),
    ).rejects.toThrow(/unpacked content exceeds expert squad archive limit/)
  }, 20000)

  test("rejects ZIP path traversal, absolute paths, and duplicate normalized entries", async () => {
    await using project = await tmpdir()
    const traversal = await zipBase64([
      ...Object.entries(packageFileMap("pkg")),
      ["pkg/../evil.txt", "bad"],
    ])
    await expect(
      ExpertSquadPackageManager.importArchive({ projectDirectory: project.path, archiveBase64: traversal, replace: false }),
    ).rejects.toThrow(/unsafe expert squad archive path/)

    const absolute = await zipBase64([
      ...Object.entries(packageFileMap("pkg")),
      ["/pkg/README.md", "# absolute duplicate\n"],
    ])
    await expect(
      ExpertSquadPackageManager.importArchive({ projectDirectory: project.path, archiveBase64: absolute, replace: false }),
    ).rejects.toThrow(/absolute expert squad archive path/)

    const colon = await zipBase64([
      ...Object.entries(packageFileMap("pkg")),
      ["pkg/README.md:ads", "# alternate data stream\n"],
    ])
    await expect(
      ExpertSquadPackageManager.importArchive({ projectDirectory: project.path, archiveBase64: colon, replace: false }),
    ).rejects.toThrow(/unsafe expert squad archive path/)

    const duplicate = await zipBase64([
      ...Object.entries(packageFileMap("pkg")),
      ["pkg\\README.md", "# duplicate\n"],
    ])
    await expect(
      ExpertSquadPackageManager.importArchive({ projectDirectory: project.path, archiveBase64: duplicate, replace: false }),
    ).rejects.toThrow(/Duplicate expert squad archive path/)
  })

  test("rejects ZIP case collisions and file-directory collisions", async () => {
    await using project = await tmpdir()
    const caseCollision = await zipBase64([
      ...Object.entries(packageFileMap("pkg")),
      ["pkg/readme.md", "# duplicate by case\n"],
    ])
    await expect(
      ExpertSquadPackageManager.importArchive({ projectDirectory: project.path, archiveBase64: caseCollision, replace: false }),
    ).rejects.toThrow(/Duplicate expert squad archive path/)

    const fileDirectoryCollision = await zipBase64([
      ...Object.entries(packageFileMap("pkg")),
      ["pkg/agents", "file collides with agents directory"],
    ])
    await expect(
      ExpertSquadPackageManager.importArchive({
        projectDirectory: project.path,
        archiveBase64: fileDirectoryCollision,
        replace: false,
      }),
    ).rejects.toThrow(/file\/directory collision/)
  })

  test("rejects export IDs that are not manifest IDs", async () => {
    await using project = await tmpdir()

    await expect(ExpertSquadPackageManager.exportArchive({ projectDirectory: project.path, id: `../${PACKAGE_ID}` })).rejects.toThrow(
      /invalid expert squad id/,
    )
  })

  test("rejects export when an installed package contains OpenCorvus runtime internals", async () => {
    await using project = await tmpdir()
    await using source = await tmpdir()
    const sourceRoot = await writeSourcePackage(source.path)
    const imported = await ExpertSquadPackageManager.importDirectory({
      projectDirectory: project.path,
      sourceDirectory: sourceRoot,
      replace: false,
    })
    await writeFile(imported.targetRoot, ".opencorvus/r/runtime/worktrees/.opencorvus-meta.json", "{}")

    await expect(ExpertSquadPackageManager.exportArchive({ projectDirectory: project.path, id: PACKAGE_ID })).rejects.toThrow(
      /runtime-internal entry ".opencorvus" is not allowed/,
    )
  })

  test("exports a canonical package ZIP that can be imported into another project", async () => {
    await using first = await tmpdir()
    await using second = await tmpdir()
    await using source = await tmpdir()
    const sourceRoot = await writeSourcePackage(source.path)
    await ExpertSquadPackageManager.importDirectory({ projectDirectory: first.path, sourceDirectory: sourceRoot, replace: false })

    const exported = await ExpertSquadPackageManager.exportArchive({ projectDirectory: first.path, id: PACKAGE_ID })
    const entries = await zipEntries(exported.bytes)

    expect(exported.filename).toBe(`${PACKAGE_ID}-expert-squad.zip`)
    expect(exported.fileCount).toBe(entries.size)
    expect(entries.has(ExpertSquadRegistry.MANIFEST)).toBe(false)
    expect(entries.get(`${PACKAGE_ID}/${ExpertSquadRegistry.MANIFEST}`)).toContain(`"id": "${PACKAGE_ID}"`)
    expect(entries.get(`${PACKAGE_ID}/agents/general/system.md`)).toBe("general overlay")
    expect(Array.from(entries.keys()).some((entry) => entry.includes(".opencorvus/r"))).toBe(false)

    const imported = await ExpertSquadPackageManager.importArchive({
      projectDirectory: second.path,
      archiveBase64: Buffer.from(exported.bytes).toString("base64"),
      replace: false,
    })
    expect(imported.id).toBe(PACKAGE_ID)
    await expect(ExpertSquadRegistry.loadPackage(imported.targetRoot)).resolves.toMatchObject({ id: PACKAGE_ID })
  })
})
