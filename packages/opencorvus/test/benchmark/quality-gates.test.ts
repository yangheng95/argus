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

    const metrics = await deriveRunMetrics({
      rootDir: tmp.path,
      changedFiles: ["src/entities/README.md", "src/services/README.md", "app.json", "src/feature.ts"],
      completedAt: Date.now(),
      evaluationChecks: [{ status: "passed", name: "build" }],
      events: [{ summary: "implemented feature" }],
    })
    const verdict = evaluateQualityGates({
      artifactAudit: audit,
      runMetrics: metrics,
      taskStatus: "completed",
      evaluationVerdict: "accepted",
    })
    expect(verdict.verdict).toBe("rejected")
    expect(verdict.failures.some((item) => item.category === "artifact_quality")).toBe(true)
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
    })

    expect(audit.out_of_scope_file_count).toBe(1)
    expect(metrics.scope_drift_score).toBeGreaterThan(0)
    expect(verdict.verdict).toBe("rejected")
    expect(verdict.failures.some((item) => item.category === "scope_drift")).toBe(true)
  })

  test("quality gate rejects placeholder implementations", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.mkdir(path.join(tmp.path, "src"), { recursive: true })
    await Bun.write(path.join(tmp.path, "src", "feature.ts"), "export function feature() { // TODO\n  return null\n}\n")

    const changedFiles = ["src/feature.ts"]
    const audit = await auditWorkspace({
      rootDir: tmp.path,
      changedFiles,
      request: "Implement the feature.",
    })
    const metrics = await deriveRunMetrics({
      rootDir: tmp.path,
      changedFiles,
      completedAt: Date.now(),
      evaluationChecks: [{ status: "passed", name: "build" }],
      events: [{ summary: "implemented feature" }],
    })
    const verdict = evaluateQualityGates({
      artifactAudit: audit,
      runMetrics: metrics,
      taskStatus: "completed",
      evaluationVerdict: "accepted",
    })

    expect(audit.placeholder_count).toBe(1)
    expect(verdict.verdict).toBe("rejected")
    expect(verdict.primary_failure).toBe("acceptance_gap")
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
    })

    expect(moduleBlocks).toEqual([{
      id: "request-scope",
      owned_paths: ["src/note-store.ts", "src/note-store.test.ts"],
    }])
    expect(audit.out_of_scope_files).toEqual(["package.json", "bun.lock"])
    expect(verdict.verdict).toBe("rejected")
    expect(verdict.primary_failure).toBe("scope_drift")
  })

  test("quality gate acceptance does not depend on vacuous local verify exit code", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.mkdir(path.join(tmp.path, "src"), { recursive: true })
    await Bun.write(path.join(tmp.path, "src", "feature.ts"), "export const feature = 1\n")

    const metrics = await deriveRunMetrics({
      rootDir: tmp.path,
      changedFiles: ["src/feature.ts"],
      completedAt: Date.now(),
      evaluationChecks: [{ status: "passed", name: "build" }],
      events: [{ summary: "implemented feature" }],
    })
    const audit = await auditWorkspace({
      rootDir: tmp.path,
      changedFiles: ["src/feature.ts"],
      request: "Implement the feature.",
    })
    const verdict = evaluateQualityGates({
      artifactAudit: audit,
      runMetrics: metrics,
      taskStatus: "completed",
      evaluationVerdict: "accepted",
    })

    expect(verdict.verdict).toBe("accepted")
    expect(verdict.failures.some((item) => item.evidence.includes("localVerifyExitCode"))).toBe(false)
  })

  test("quality gate rejects failed configured local verification", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.mkdir(path.join(tmp.path, "src"), { recursive: true })
    await Bun.write(path.join(tmp.path, "src", "feature.ts"), "export const feature = 1\n")
    const changedFiles = ["src/feature.ts"]
    const metrics = await deriveRunMetrics({
      rootDir: tmp.path,
      changedFiles,
      completedAt: Date.now(),
      evaluationChecks: [{ status: "passed", name: "build" }],
      events: [{ summary: "implemented feature" }],
    })
    const verdict = evaluateQualityGates({
      artifactAudit: await auditWorkspace({
        rootDir: tmp.path,
        changedFiles,
        request: "Implement the feature.",
      }),
      runMetrics: metrics,
      taskStatus: "completed",
      evaluationVerdict: "accepted",
      localVerify: {
        status: "completed",
        exitCode: 1,
        command: "bun test",
      },
    })

    expect(verdict.verdict).toBe("rejected")
    expect(verdict.failures.some((item) => item.message.includes("local verification"))).toBe(true)
  })

  test("quality gate rejects configured local verification that never ran", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.mkdir(path.join(tmp.path, "src"), { recursive: true })
    await Bun.write(path.join(tmp.path, "src", "feature.ts"), "export const feature = 1\n")
    const changedFiles = ["src/feature.ts"]
    const metrics = await deriveRunMetrics({
      rootDir: tmp.path,
      changedFiles,
      completedAt: Date.now(),
      evaluationChecks: [{ status: "passed", name: "build" }],
      events: [{ summary: "implemented feature" }],
    })
    const verdict = evaluateQualityGates({
      artifactAudit: await auditWorkspace({
        rootDir: tmp.path,
        changedFiles,
        request: "Implement the feature.",
      }),
      runMetrics: metrics,
      taskStatus: "completed",
      evaluationVerdict: "accepted",
      localVerify: {
        status: "not_run",
        exitCode: null,
        command: "bun run visual-diff",
      },
    })

    expect(verdict.verdict).toBe("rejected")
    expect(verdict.failures.some((item) => item.message.includes("was not executed"))).toBe(true)
  })

  test("package lockfiles are config files, not scaffold expansion flags", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "package-lock.json"), "{}\n")
    await Bun.write(path.join(tmp.path, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n")
    await Bun.write(path.join(tmp.path, "yarn.lock"), "# yarn lockfile\n")

    const audit = await auditWorkspace({
      rootDir: tmp.path,
      changedFiles: ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"],
      request: "Create a web project with a committed lockfile.",
    })

    expect(audit.config_files_added).toBe(3)
    expect(audit.scaffold_expansion_flags).toEqual([])
    expect(audit.scaffold_noise_count).toBe(0)
  })
})
