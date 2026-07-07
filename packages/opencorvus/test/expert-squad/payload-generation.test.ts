import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  discoverExpertSquadPayloadPackages,
  renderExpertSquadPayloadModule,
  resolveExpertSquadPayloadModulePath,
} from "../../script/generate-expert-squad-payload"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")

function expectGitIndexContains(relativePaths: string[]) {
  const result = Bun.spawnSync({
    cmd: ["git", "ls-files", "--error-unmatch", "--", ...relativePaths],
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = new TextDecoder().decode(result.stdout).trim()
  const stderr = new TextDecoder().decode(result.stderr).trim()
  expect(stderr).toBe("")
  expect(result.exitCode).toBe(0)
  expect(stdout.split(/\r?\n/).filter(Boolean).sort()).toEqual([...relativePaths].sort())
}

describe("expert squad payload generation", () => {
  test("checked-in payload module is generated from repository expert-squad packages", async () => {
    const modulePath = resolveExpertSquadPayloadModulePath(repoRoot)
    expect(await fs.readFile(modulePath, "utf8")).toBe(await renderExpertSquadPayloadModule(repoRoot))
  })

  test("payload TypeScript sources are embedded without text-import module shadow", async () => {
    const source = await renderExpertSquadPayloadModule(repoRoot)
    const textImportLines = source
      .split("\n")
      .filter((line) => line.startsWith("import payload_") && line.includes('with { type: "text" }'))

    expect(textImportLines.length).toBeGreaterThan(0)
    expect(source).not.toContain(`opentest-protocol-engine.ts" with { type: "text" }`)
    expect(source).not.toContain(`opentest-runner.ts" with { type: "text" }`)
    expect(source).toContain(`"protocol-engine/opentest-protocol-engine.ts":`)
    expect(source).toContain(`"tools/opentest-protocol-engine.ts":`)
    expect(source).toContain(`"tools/opentest-runner.ts":`)
    expect(source).toContain("export function parseProtocolContract")
    expect(source).toContain(`.opencorvus/expert-squads/builtin/algorithm/README.md" with { type: "text" }`)
  })

  test("payload source files are tracked delivery inputs", async () => {
    const packages = await discoverExpertSquadPayloadPackages(repoRoot)
    const sourceFiles = packages.flatMap((pkg) =>
      pkg.files.map((relativePath) =>
        path.relative(repoRoot, path.join(pkg.root, ...relativePath.split("/"))).replaceAll(path.sep, "/"),
      ),
    )

    expectGitIndexContains([...new Set(sourceFiles)])
  })

  test("payload text imports are resolvable by Bun build", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-payload-build-"))
    const entrypoint = path.join(tempRoot, "entry.ts")
    const outdir = path.join(tempRoot, "out")
    try {
      await fs.writeFile(
        entrypoint,
        [
          `import { payloadPackageSources } from ${JSON.stringify(path.join(repoRoot, "packages/opencorvus/src/expert-squad/payload.ts").replaceAll(path.sep, "/"))}`,
          'const algorithm = payloadPackageSources.find((source) => source.id === "algorithm")',
          'const opentest = payloadPackageSources.find((source) => source.id === "opentest")',
          'if (!algorithm?.files["README.md"].includes("Algorithm Expert Squad")) throw new Error("missing README payload")',
          'const protocol = opentest?.files["tools/opentest-protocol-engine.ts"] ?? ""',
          'if (!protocol.includes("OpenTestProtocolEngine")) throw new Error("missing TypeScript payload")',
        ].join("\n"),
      )
      const result = await Bun.build({
        entrypoints: [entrypoint],
        outdir,
        target: "bun",
      })
      expect(result.success).toBe(true)
      expect(result.logs.map((item) => item.message)).toEqual([])
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true })
    }
  })
})
