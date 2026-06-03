import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"

import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import {
  ensureLiveWebpageEvidence,
  hasCompletePrimaryEvidence,
  primaryWebpageEvidenceArtifacts,
  type LiveWebpageEvidencePipeline,
} from "../../src/orchestrator/webpage-evidence"
import { tmpdir } from "../fixture/fixture"

describe("live webpage evidence pipeline", () => {
  test("runs extract, compile, and analyze when primary mirror evidence is missing", async () => {
    await using tmp = await tmpdir()
    const taskID = "tsk_webpage_evidence_generate"
    const calls: string[] = []
    const pipeline = fakePipeline(calls)

    const result = await ensureLiveWebpageEvidence({
      projectDir: tmp.path,
      worktreeDir: tmp.path,
      taskID,
      urls: ["https://example.com/markets"],
      pipeline,
    })

    const mirrorDir = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID).mirrorAbsolute
    expect(result.status).toBe("generated")
    expect(calls).toEqual(["extract:https://example.com/markets", "compile", "analyze", "captureRuntimeState:https://example.com/markets"])
    expect(await hasCompletePrimaryEvidence(mirrorDir, "https://example.com/markets")).toBe(true)
    const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
    expect(result.artifacts).toContain(path.posix.join(paths.mirrorRelative, "source-skeleton/index.html"))
    expect(result.artifacts).toContain(path.posix.join(paths.mirrorRelative, "singlefile.html"))
    expect(result.artifacts).toContain(path.posix.join(paths.mirrorRelative, "source-skeleton/used-selectors.json"))
    expect(result.artifacts).toContain(path.posix.join(paths.mirrorRelative, "source-skeleton/skeleton-manifest.json"))
    expect(result.artifacts).toContain(path.posix.join(paths.mirrorRelative, "source-ir/component-tree.json"))
    expect(result.artifacts).toContain(path.posix.join(paths.mirrorRelative, "source-ir/interaction-state-snapshots.json"))
    expect(result.artifacts).toContain(path.posix.join(paths.mirrorRelative, "interaction-states/scroll-50.png"))
    expect(result.artifacts).toContain(path.posix.join(paths.mirrorRelative, "visual-surface-candidates.json"))
    expect(result.artifacts).toContain(path.posix.join(paths.mirrorRelative, "visual-surface-scaffold.json"))
    expect(result.artifacts).toContain(path.posix.join(paths.sourcePackageRelative, "README.md"))
    expect(result.artifacts).toContain(path.posix.join(paths.sourcePackageRelative, "singlefile.html"))
    expect(result.artifacts).toContain(path.posix.join(paths.sourcePackageRelative, "implementation-blueprint.md"))
    expect(result.artifacts).toContain(path.posix.join(paths.sourcePackageRelative, "source-skeleton/critical.css"))
    expect(result.artifacts).toContain(path.posix.join(paths.sourcePackageRelative, "source-ir/interaction-state-snapshots.json"))
    expect(result.artifacts).toContain(path.posix.join(paths.sourcePackageRelative, "interaction-states/scroll-50.png"))
    expect(result.artifacts).toContain(path.posix.join(paths.sourcePackageRelative, "source-skeleton/used-selectors.json"))
    expect(result.artifacts).toContain(path.posix.join(paths.sourcePackageRelative, "source-skeleton/skeleton-manifest.json"))
    expect(result.artifacts).toContain(path.posix.join(paths.sourcePackageRelative, "visual-surface-candidates.json"))
    expect(result.artifacts).toContain(path.posix.join(paths.sourcePackageRelative, "visual-surface-scaffold.json"))
    expect(result.artifacts).toContain(path.posix.join(paths.sourcePackageRelative, "assets/manifest.json"))
    expect(await fileExists(path.join(tmp.path, "web-clone-source", "README.md"))).toBe(false)
    expect(await fileExists(path.join(paths.sourcePackageAbsolute, "README.md"))).toBe(true)
    expect(await fileExists(path.join(paths.sourcePackageAbsolute, "implementation-blueprint.md"))).toBe(true)
    expect(await fileExists(path.join(paths.sourcePackageAbsolute, "visual-surface-scaffold.json"))).toBe(true)
    expect(await fileExists(path.join(paths.sourcePackageAbsolute, "source-ir", "interaction-state-snapshots.json"))).toBe(true)
  })

  test("reuses complete mirror evidence for the same URL", async () => {
    await using tmp = await tmpdir()
    const taskID = "tsk_webpage_evidence_reuse"
    const mirrorDir = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID).mirrorAbsolute
    await writeCompleteEvidence(mirrorDir, "https://example.com/markets")
    const calls: string[] = []

    const result = await ensureLiveWebpageEvidence({
      projectDir: tmp.path,
      worktreeDir: tmp.path,
      taskID,
      urls: ["https://example.com/markets/"],
      pipeline: fakePipeline(calls),
    })

    expect(result.status).toBe("reused")
    expect(calls).toEqual([])
    const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
    expect(result.artifacts).toContain(path.posix.join(paths.sourcePackageRelative, "README.md"))
    expect(result.artifacts).toContain(path.posix.join(paths.sourcePackageRelative, "singlefile.html"))
    expect(result.artifacts).toContain(path.posix.join(paths.sourcePackageRelative, "implementation-blueprint.md"))
    expect(result.artifacts).toContain(path.posix.join(paths.sourcePackageRelative, "visual-surface-scaffold.json"))
    expect(await fileExists(path.join(tmp.path, "web-clone-source", "web-clone-context.md"))).toBe(false)
    expect(await fileExists(path.join(paths.sourcePackageAbsolute, "web-clone-context.md"))).toBe(true)
  })

  test("repoints the project mirror view from a previous task to the current task", async () => {
    await using tmp = await tmpdir()
    const firstCalls: string[] = []
    await ensureLiveWebpageEvidence({
      projectDir: tmp.path,
      worktreeDir: tmp.path,
      taskID: "tsk_webpage_evidence_first",
      urls: ["https://example.com/first"],
      pipeline: fakePipeline(firstCalls),
    })

    const secondCalls: string[] = []
    const result = await ensureLiveWebpageEvidence({
      projectDir: tmp.path,
      worktreeDir: tmp.path,
      taskID: "tsk_webpage_evidence_second",
      urls: ["https://example.com/second"],
      pipeline: fakePipeline(secondCalls),
    })

    const secondPaths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, "tsk_webpage_evidence_second")
    expect(result.status).toBe("generated")
    expect(secondCalls).toEqual(["extract:https://example.com/second", "compile", "analyze", "captureRuntimeState:https://example.com/second"])
    expect(await fileExists(path.join(tmp.path, "mirror", "reference.png"))).toBe(false)
    expect(await fileExists(path.join(tmp.path, "web-clone-source", "reference.png"))).toBe(false)
    expect(await fileExists(path.join(secondPaths.mirrorAbsolute, "reference.png"))).toBe(true)
    expect(await fileExists(path.join(secondPaths.sourcePackageAbsolute, "reference.png"))).toBe(true)
    expect(await fileExists(path.join(secondPaths.sourcePackageAbsolute, "singlefile.html"))).toBe(true)
  })

  test("rejects a pipeline run that does not produce the source skeleton and IR", async () => {
    await using tmp = await tmpdir()

    await expect(ensureLiveWebpageEvidence({
      projectDir: tmp.path,
      worktreeDir: tmp.path,
      taskID: "tsk_webpage_evidence_incomplete",
      urls: ["https://example.com/markets"],
      pipeline: {
        extract: async ({ outputDir, url }) => {
          await fs.mkdir(outputDir, { recursive: true })
          await fs.writeFile(path.join(outputDir, "extracted-page.json"), JSON.stringify({ url }), "utf8")
        },
        compile: async () => {},
        analyze: async () => {},
        captureRuntimeState: async () => {},
      },
    })).rejects.toThrow("did not produce the complete primary mirror artifact set")
  })
})

function fakePipeline(calls: string[]): LiveWebpageEvidencePipeline {
  return {
    extract: async ({ outputDir, url }) => {
      calls.push(`extract:${url}`)
      await fs.mkdir(outputDir, { recursive: true })
      await fs.writeFile(path.join(outputDir, "extracted-page.json"), JSON.stringify({ url }), "utf8")
    },
    compile: async ({ outputDir }) => {
      calls.push("compile")
      await fs.mkdir(outputDir, { recursive: true })
    },
    analyze: async ({ outputDir }) => {
      calls.push("analyze")
      const extracted = JSON.parse(await fs.readFile(path.join(outputDir, "extracted-page.json"), "utf8"))
      await writeCompleteEvidence(outputDir, extracted.url)
    },
    captureRuntimeState: async ({ outputDir, url }) => {
      calls.push(`captureRuntimeState:${url}`)
      await writeRuntimeStateEvidence(outputDir, url)
    },
  }
}

async function fileExists(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isFile()
  } catch {
    return false
  }
}

async function writeCompleteEvidence(mirrorDir: string, url: string): Promise<void> {
  await fs.mkdir(mirrorDir, { recursive: true })
  for (const artifact of primaryWebpageEvidenceArtifacts()) {
    const relative = artifact.replace(/^mirror[\\/]/, "")
    const file = path.join(mirrorDir, relative)
    await fs.mkdir(path.dirname(file), { recursive: true })
    if (relative === "reference.png") {
      await fs.writeFile(file, minimalPngBytes())
      continue
    }
    if (relative.startsWith("interaction-states/") && relative.endsWith(".png")) {
      await fs.writeFile(file, minimalPngBytes())
      continue
    }
    const content =
      relative === "extracted-page.json"
        ? JSON.stringify({ url })
        : relative === "source-skeleton/source-skeleton-audit.json" || relative === "source-ir/source-quality-audit.json"
          ? JSON.stringify({ passed: true })
          : relative.endsWith(".json")
            ? JSON.stringify({ version: 1 })
            : `${relative}\n`
    await fs.writeFile(file, content, "utf8")
  }
}

async function writeRuntimeStateEvidence(mirrorDir: string, url: string): Promise<void> {
  await fs.mkdir(path.join(mirrorDir, "source-ir"), { recursive: true })
  await fs.mkdir(path.join(mirrorDir, "interaction-states"), { recursive: true })
  for (const name of ["initial.png", "scroll-25.png", "scroll-50.png", "scroll-75.png"]) {
    await fs.writeFile(path.join(mirrorDir, "interaction-states", name), minimalPngBytes())
  }
  await fs.writeFile(path.join(mirrorDir, "source-ir", "interaction-state-snapshots.json"), JSON.stringify({
    version: 1,
    purpose: "webpage-runtime-interaction-state-evidence",
    source: { url, viewport: { width: 1440, height: 900 }, captureEngine: "playwright" },
    artifacts: { screenshotsDir: "interaction-states" },
    snapshots: [
      { id: "initial", scrollY: 0, navigationClusters: [] },
      { id: "scroll-50", scrollY: 600, navigationClusters: [] },
    ],
    observations: [
      {
        kind: "persistent-viewport-position",
        description: "Element text and viewport Y remain stable while document scroll position changes.",
        elementKey: "tab:overview countries ideas",
      },
    ],
  }), "utf8")
}

function minimalPngBytes(): Uint8Array {
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
    0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ])
}
