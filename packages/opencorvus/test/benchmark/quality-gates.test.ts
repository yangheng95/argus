import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { auditWorkspace, deriveRunMetrics, evaluateQualityGates, moduleBlocksFromRequest } from "../../script/benchmark/quality-gates"
import { tmpdir } from "../fixture/fixture"

describe("benchmark quality gates", () => {
  test("artifact audit flags README proliferation and scaffold noise", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.mkdir(path.join(tmp.path, "src", "entities"), { recursive: true })
    await fs.mkdir(path.join(tmp.path, "src", "services"), { recursive: true })
    await Bun.write(path.join(tmp.path, "src", "entities", "README.md"), "# entities\n")
    await Bun.write(path.join(tmp.path, "src", "services", "README.md"), "# services\n")
    await Bun.write(path.join(tmp.path, "app.json"), "{}\n")
    await Bun.write(path.join(tmp.path, "src", "feature.ts"), "export const feature = 1\n")

    const audit = await auditWorkspace({
      rootDir: tmp.path,
      changedFiles: [
        "src/entities/README.md",
        "src/services/README.md",
        "app.json",
        "src/feature.ts",
      ],
      request: "Implement a feature without README or scaffold files.",
    })

    expect(audit.readme_proliferation_count).toBe(2)
    expect(audit.scaffold_noise_count).toBeGreaterThan(0)
    expect(audit.doc_files_added).toBe(2)
  })

  test("quality gate blocks long verification loops", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.mkdir(path.join(tmp.path, "src"), { recursive: true })
    await Bun.write(path.join(tmp.path, "src", "feature.ts"), "export const feature = 1\n")
    const completedAt = Date.now()
    const metrics = await deriveRunMetrics({
      rootDir: tmp.path,
      changedFiles: ["src/feature.ts"],
      completedAt,
      evaluationChecks: [{ status: "passed", name: "verify_cmd" }],
      events: Array.from({ length: 8 }, () => ({
        summary: "verify project structure and README",
      })),
    })
    const verdict = evaluateQualityGates({
      artifactAudit: await auditWorkspace({
        rootDir: tmp.path,
        changedFiles: ["src/feature.ts"],
        request: "Implement the feature.",
      }),
      runMetrics: {
        ...metrics,
        meaningful_change_gap_ms: 20 * 60 * 1000,
      },
      taskStatus: "completed",
      evaluationVerdict: "accepted",
      localVerifyExitCode: 0,
    })

    expect(verdict.verdict).toBe("blocked")
    expect(verdict.primary_failure).toBe("liveness")
  })

  test("quality gate rejects changes outside approved module blocks", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.mkdir(path.join(tmp.path, "src", "hero"), { recursive: true })
    await fs.mkdir(path.join(tmp.path, "src", "search"), { recursive: true })
    await Bun.write(path.join(tmp.path, "src", "hero", "index.ts"), "export const hero = 1\n")
    await Bun.write(path.join(tmp.path, "src", "search", "index.ts"), "export const search = 1\n")

    const moduleBlocks = [{
      id: "hero",
      owned_paths: ["src/hero"],
    }]
    const audit = await auditWorkspace({
      rootDir: tmp.path,
      changedFiles: ["src/hero/index.ts", "src/search/index.ts"],
      request: "Only update the hero module.",
      moduleBlocks,
    })
    const metrics = await deriveRunMetrics({
      rootDir: tmp.path,
      changedFiles: ["src/hero/index.ts", "src/search/index.ts"],
      completedAt: Date.now(),
      evaluationChecks: [{ status: "passed", name: "build" }],
      events: [{ summary: "implement hero module" }],
      moduleBlocks,
    })
    const verdict = evaluateQualityGates({
      artifactAudit: audit,
      runMetrics: metrics,
      taskStatus: "completed",
      evaluationVerdict: "accepted",
      localVerifyExitCode: 0,
    })

    expect(audit.out_of_scope_file_count).toBe(1)
    expect(metrics.scope_drift_score).toBeGreaterThan(0)
    expect(verdict.verdict).toBe("rejected")
    expect(verdict.failures.some((item) => item.category === "scope_drift")).toBe(true)
  })

  test("request-scoped module blocks reject package manifest churn outside allowed files", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.mkdir(path.join(tmp.path, "src"), { recursive: true })
    await Bun.write(path.join(tmp.path, "src", "note-store.ts"), "export const noteStore = 1\n")
    await Bun.write(path.join(tmp.path, "src", "note-store.test.ts"), "export const testFile = 1\n")
    await Bun.write(path.join(tmp.path, "package.json"), "{\n  \"name\": \"tmp\"\n}\n")
    await Bun.write(path.join(tmp.path, "bun.lock"), "lockfile\n")

    const moduleBlocks = moduleBlocksFromRequest([
      "Implement a minimal NoteStore.",
      "",
      "Only create or modify these files:",
      "- src/note-store.ts",
      "- src/note-store.test.ts",
      "",
      "Do not add package.json, tsconfig.json, README files, docs, or any other files unless they are strictly required.",
    ].join("\n"))

    const changedFiles = ["src/note-store.ts", "src/note-store.test.ts", "package.json", "bun.lock"]
    const audit = await auditWorkspace({
      rootDir: tmp.path,
      changedFiles,
      request: "Only create or modify these files:\n- src/note-store.ts\n- src/note-store.test.ts",
      moduleBlocks,
    })
    const metrics = await deriveRunMetrics({
      rootDir: tmp.path,
      changedFiles,
      completedAt: Date.now(),
      evaluationChecks: [{ status: "passed", name: "verify_cmd" }],
      events: [{ summary: "implemented note store" }],
      moduleBlocks,
    })
    const verdict = evaluateQualityGates({
      artifactAudit: audit,
      runMetrics: metrics,
      taskStatus: "completed",
      evaluationVerdict: "accepted",
      localVerifyExitCode: 0,
    })

    expect(moduleBlocks).toEqual([{
      id: "request-scope",
      owned_paths: ["src/note-store.ts", "src/note-store.test.ts"],
    }])
    expect(audit.out_of_scope_files).toEqual(["package.json", "bun.lock"])
    expect(verdict.verdict).toBe("rejected")
    expect(verdict.primary_failure).toBe("scope_drift")
  })
})
