import { BlobReader, TextReader, TextWriter, Uint8ArrayWriter, ZipReader, ZipWriter } from "@zip.js/zip.js"
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { ExpertSquadPackageManager } from "../../src/expert-squad/manager"
import { ExpertSquadRegistry } from "../../src/expert-squad/registry"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

async function writeFile(root: string, relativePath: string, content: string) {
  const target = path.join(root, relativePath)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, content)
}

async function readJsonFile(file: string) {
  return JSON.parse(await fs.readFile(file, "utf8"))
}

async function writePromptProfileConfig(projectRoot: string) {
  const value = {
    prompt_profile: {
      active: "backend",
      profiles: {
        "custom-squad": {
          label: "Custom Squad",
          description: "Project-defined overlays stay untouched by package import.",
          agents: {
            build: "Custom build guidance.",
          },
        },
      },
    },
  }
  const file = path.join(projectRoot, "opencorvus.json")
  await fs.writeFile(file, JSON.stringify(value, null, 2))
  return { file, value }
}

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    id: "frontend-replica",
    label: "Frontend Replica",
    description: "Replica squad",
    version: "2026.07.03",
    readme: "README.md",
    selector: {
      summary: "Use for replica tasks.",
      selection_guidance: "Call select_expert_squad with profile_id frontend-replica.",
    },
    capability_projection: {
      scheduler: {
        role_base: true,
        built_in_tool_ids: ["select_expert_squad", "skill", "build"],
        package_tool_refs: ["frontend-replica/orchestrator/source-evidence"],
        package_skill_refs: ["frontend-replica/orchestrator/scheduler"],
      },
      agents: {
        build: {
          role_base: true,
          package_skill_refs: ["frontend-replica/build/implementation"],
          package_tool_refs: ["frontend-replica/build/build-evidence"],
        },
      },
    },
    agents: {
      orchestrator: {
        prompt: "agents/orchestrator/system.md",
        skill_refs: ["frontend-replica/orchestrator/scheduler"],
        tool_refs: ["frontend-replica/orchestrator/source-evidence"],
      },
      build: {
        prompt: "agents/build/system.md",
        skill_refs: ["frontend-replica/build/implementation"],
        tool_refs: ["frontend-replica/build/build-evidence"],
      },
    },
    ...overrides,
  }
}

function packageFileMap(prefix = "", overrides: Record<string, string> = {}) {
  const root = prefix ? `${prefix.replace(/\/+$/, "")}/` : ""
  return {
    [`${root}README.md`]: "# Frontend Replica\n",
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

  test("imports a source folder into the canonical expert-squad directory without selecting it", async () => {
    await using project = await tmpdir({ git: true })
    await using source = await tmpdir()
    const sourceRoot = await writeSourcePackage(source.path, "arbitrary-upload-name")
    const projectConfig = await writePromptProfileConfig(project.path)
    const sessionOverlay = { prompt_profile: { active: "frontend-innovate" } } as const

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

    const targetRoot = path.join(project.path, ".opencorvus", "expert-squads", "frontend-replica")
    expect(imported).toEqual({ id: "frontend-replica", targetRoot, replaced: false })
    expect(await fs.readFile(path.join(targetRoot, "README.md"), "utf8")).toContain("Frontend Replica")
    await expect(ExpertSquadRegistry.loadPackage(targetRoot)).resolves.toMatchObject({ id: "frontend-replica" })
    expect(await readJsonFile(projectConfig.file)).toEqual(projectConfig.value)
    expect(await ExpertSquadRegistry.discover(project.path)).toHaveLength(1)
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

    expect(imported.id).toBe("frontend-replica")
    expect(imported.targetRoot).toBe(path.join(project.path, ".opencorvus", "expert-squads", "frontend-replica"))
    expect(await readJsonFile(projectConfig.file)).toEqual(projectConfig.value)
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
    await expect(ExpertSquadRegistry.loadPackage(first.targetRoot)).resolves.toMatchObject({ id: "frontend-replica" })
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
    await writeFile(project.path, ".opencorvus/expert-squads/frontend-replica", "not a directory")

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
    await expect(ExpertSquadRegistry.loadPackage(imported.targetRoot)).resolves.toMatchObject({ id: "frontend-replica" })
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
    await expect(ExpertSquadRegistry.loadPackage(imported.targetRoot)).resolves.toMatchObject({ id: "frontend-replica" })
  })

  test("failed first install removes the newly moved target", async () => {
    await using project = await tmpdir()
    await using source = await tmpdir()
    const sourceRoot = await writeSourcePackage(source.path)
    const targetRoot = path.join(project.path, ".opencorvus", "expert-squads", "frontend-replica")
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
    const targetRoot = path.join(project.path, ".opencorvus", "expert-squads", "frontend-replica")
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
  })

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

    await expect(ExpertSquadPackageManager.exportArchive({ projectDirectory: project.path, id: "../frontend-replica" })).rejects.toThrow(
      /invalid expert squad id/,
    )
  })

  test("exports a canonical package ZIP that can be imported into another project", async () => {
    await using first = await tmpdir()
    await using second = await tmpdir()
    await using source = await tmpdir()
    const sourceRoot = await writeSourcePackage(source.path)
    await ExpertSquadPackageManager.importDirectory({ projectDirectory: first.path, sourceDirectory: sourceRoot, replace: false })

    const exported = await ExpertSquadPackageManager.exportArchive({ projectDirectory: first.path, id: "frontend-replica" })
    const entries = await zipEntries(exported.bytes)

    expect(exported.filename).toBe("frontend-replica-expert-squad.zip")
    expect(exported.fileCount).toBe(entries.size)
    expect(entries.has(ExpertSquadRegistry.MANIFEST)).toBe(false)
    expect(entries.get(`frontend-replica/${ExpertSquadRegistry.MANIFEST}`)).toContain('"id": "frontend-replica"')
    expect(Array.from(entries.keys()).some((entry) => entry.includes(".opencorvus/r"))).toBe(false)

    const imported = await ExpertSquadPackageManager.importArchive({
      projectDirectory: second.path,
      archiveBase64: Buffer.from(exported.bytes).toString("base64"),
      replace: false,
    })
    expect(imported.id).toBe("frontend-replica")
    await expect(ExpertSquadRegistry.loadPackage(imported.targetRoot)).resolves.toMatchObject({ id: "frontend-replica" })
  })
})
