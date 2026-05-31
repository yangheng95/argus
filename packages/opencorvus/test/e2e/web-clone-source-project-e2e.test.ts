import { describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { ToolRegistry } from "../../src/tool/registry"
import { WebCloneGenerateSourceProjectTool } from "../../src/tool/web-clone-generate-source-project"
import { WebClonePrepareContextTool } from "../../src/tool/web-clone-prepare-context"
import { WebCloneSourceAuditTool } from "../../src/tool/web-clone-source-audit"

const runE2E = process.env.OPENCORVUS_RUN_WEB_CLONE_E2E === "1" || process.env.OPENCORVUS_RUN_WEB_CLONE_E2E === "true"
const e2eTest = runE2E ? test : test.skip
const repoRoot = path.resolve(import.meta.dir, "../../../..")
const defaultMirrorDir = path.join(repoRoot, ".tmp", "source-skeleton-tradingview-v2h", "mirror")
const mirrorDir = path.resolve(process.env.OPENCORVUS_WEB_CLONE_E2E_MIRROR ?? defaultMirrorDir)
const outputDir = path.resolve(process.env.OPENCORVUS_WEB_CLONE_E2E_OUTPUT ?? path.join(repoRoot, ".tmp", "opencorvus-web-clone-e2e-output"))
const threshold = normalizeVisualThreshold(Number(process.env.OPENCORVUS_WEB_CLONE_E2E_THRESHOLD ?? 96))
const worstThreshold = normalizeVisualThreshold(Number(process.env.OPENCORVUS_WEB_CLONE_E2E_WORST_THRESHOLD ?? 75))

const ctx = {
  sessionID: "test-web-clone-source-project-e2e",
  messageID: "message",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("web clone source project E2E", () => {
  e2eTest("runs the OpenCorvus tool chain and enforces the visual threshold", async () => {
    await assertDirectory(mirrorDir)
    await Instance.provide({
      directory: repoRoot,
      fn: async () => {
        const toolIds = await ToolRegistry.ids()
        expect(toolIds).toContain("web_clone_prepare_context")
        expect(toolIds).toContain("web_clone_generate_source_project")
        expect(toolIds).toContain("web_clone_source_audit")

        const prepareTool = await WebClonePrepareContextTool.init()
        const context = await prepareTool.execute({ mirrorDir }, ctx)
        expect(context.title).toBe("Web clone context prepared")

        const generateTool = await WebCloneGenerateSourceProjectTool.init()
        const generated = await generateTool.execute({ mirrorDir, outputDir, overwrite: true }, ctx)
        expect(generated.title).toBe("Web clone source project generated")

        await run("bun", ["install"], outputDir)
        await run("bun", ["run", "build"], outputDir)

        const auditTool = await WebCloneSourceAuditTool.init()
        const audit = await auditTool.execute({
          projectDir: outputDir,
          sourcePackageDir: mirrorDir,
          outputPath: path.join(outputDir, "acceptance", "web-clone-source-skeleton-consumption-audit.json"),
        }, ctx)
        expect(audit.metadata.audit.passed).toBe(true)

        const acceptanceDir = path.join(outputDir, "acceptance")
        await fs.mkdir(acceptanceDir, { recursive: true })
        const visualOutDir = path.join(acceptanceDir, "overlay-visual-diff")
        const visualExitCode = await runVisualDiffCli({
          renderedDir: outputDir,
          reference: path.join(mirrorDir, "reference.png"),
          outDir: visualOutDir,
          threshold,
          worstThreshold,
        })
        const visualReport = JSON.parse(await fs.readFile(path.join(visualOutDir, "diff.json"), "utf8"))
        const report = {
          version: 1,
          purpose: "web-clone-opencorvus-e2e",
          passed: visualExitCode === 0 && visualReport.passed === true,
          threshold,
          worstThreshold,
          mirrorDir,
          outputDir,
          overlayVisualDiff: visualReport,
        }
        await fs.writeFile(path.join(acceptanceDir, "opencorvus-web-clone-e2e.json"), JSON.stringify(report, null, 2), "utf8")
        expect(report.passed, JSON.stringify(report, null, 2)).toBe(true)
      },
    })
  }, 600_000)
})

async function assertDirectory(dir: string): Promise<void> {
  const stat = await fs.stat(dir).catch(() => undefined)
  if (!stat?.isDirectory()) throw new Error(`web clone e2e mirror directory does not exist: ${dir}`)
}

function normalizeVisualThreshold(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0.96
  return value > 1 ? value / 100 : value
}

async function run(command: string, args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", windowsHide: true })
    child.on("error", reject)
    child.on("exit", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`))
    })
  })
}

async function runVisualDiffCli(input: {
  renderedDir: string
  reference: string
  outDir: string
  threshold: number
  worstThreshold: number
}): Promise<number> {
  await fs.mkdir(input.outDir, { recursive: true })
  return new Promise<number>((resolve, reject) => {
    const child = spawn("bun", [
      "run",
      path.join(repoRoot, "packages", "opencorvus", "script", "benchmark", "visual-diff.ts"),
      "--rendered-dir",
      input.renderedDir,
      "--reference",
      input.reference,
      "--out",
      input.outDir,
      "--threshold",
      String(input.threshold),
      "--worst-threshold",
      String(input.worstThreshold),
      "--headless",
      "--chrome-cli-fallback",
    ], { cwd: repoRoot, stdio: "inherit", windowsHide: true })
    child.on("error", reject)
    child.on("exit", (code) => resolve(code ?? 1))
  })
}
