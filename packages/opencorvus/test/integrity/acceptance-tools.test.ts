import { afterEach, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { Database } from "../../src/storage/db"
import { persistBrowserPreviewEvidence, persistBrowserPreviewTarget } from "../../src/browser-preview/persist"
import { tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import type { VisualEvidenceBundle } from "../../src/acceptance/visual-evidence"

function visualBundle(taskID: string, projectDirectory: string, evidenceRefs: string[]): VisualEvidenceBundle {
  return {
    id: "veb_integrity_desktop",
    taskID,
    source: "integrity",
    reference: {
      path: "webpage-evidence/reference.png",
      sha256: "sha_reference",
      width: 1440,
      height: 900,
    },
    rendered: {
      path: "webpage-evidence/rendered.png",
      sha256: "sha_rendered",
      width: 1440,
      height: 900,
      capturedAt: "2026-06-08T00:00:00.000Z",
      viewport: { width: 1440, height: 900 },
      appURL: "http://127.0.0.1:4173",
      projectDirectory,
      commitRef: "abc123",
    },
    inspection: {
      path: "visual-qa-report.json",
      reviewedAt: "2026-06-08T00:00:00.000Z",
      status: "passing",
      blockerCount: 0,
      notes: "No production blockers remain.",
    },
    regions: [
      {
        id: "region_header",
        label: "Header",
        requirementIDs: ["REQ-visual"],
        acceptanceSpecIDs: ["acc-final-visual"],
        sourceRefs: ["webpage-evidence/reference.png"],
        viewport: "desktop",
        required: true,
        status: "passing",
        evidenceRefs,
        notes: "Header matches.",
      },
    ],
  }
}

function visualBundleWithoutRequiredRegions(taskID: string, projectDirectory: string): VisualEvidenceBundle {
  const bundle = visualBundle(taskID, projectDirectory, [])
  return {
    ...bundle,
    regions: bundle.regions.map((region) => ({ ...region, required: false, evidenceRefs: [] })),
  }
}

afterEach(async () => {
  await resetDatabase()
})

async function seedTaskWithReferenceComparison(input: {
  taskID: string
  projectDirectory: string
  regionID?: string
  viewportID?: string
  operationKind?: "preview-capture" | "reference-comparison" | "source-binding"
  status?: "passed" | "failed"
  artifactNames?: Array<"source.png" | "implementation.png" | "side-by-side.png">
}): Promise<string> {
  Database.use((db) =>
    db
      .insert(EngineTaskTable)
      .values({
        id: input.taskID,
        project_id: Instance.project.id,
        title: "Integrity visual evidence task",
        request: "Inspect visual evidence",
        source: "test",
        time_created: Date.now(),
        time_updated: Date.now(),
      })
      .run(),
  )
  const artifactDir = ProjectRuntimePaths.taskAbsolute(input.projectDirectory, input.taskID, "bp", "integrity-visual")
  await fs.mkdir(artifactDir, { recursive: true })
  const artifactNames = input.artifactNames ?? ["source.png", "implementation.png", "side-by-side.png"]
  for (const file of artifactNames) {
    await fs.writeFile(path.join(artifactDir, file), `png:${file}`)
  }
  const target = await persistBrowserPreviewTarget({
    taskID: input.taskID,
    url: "http://127.0.0.1:4173/",
  })
  return persistBrowserPreviewEvidence({
    projectRoot: input.projectDirectory,
    taskID: input.taskID,
    targetID: target.id,
    viewportID: input.viewportID ?? "desktop",
    operationKind: input.operationKind ?? "reference-comparison",
    regionID: input.regionID ?? "region_header",
    status: input.status ?? "passed",
    summary: input.status === "failed" ? "Reference comparison failed." : "Reference comparison passed.",
    artifactPaths: {
      ...(artifactNames.includes("source.png") ? { source_crop: path.join(artifactDir, "source.png") } : {}),
      ...(artifactNames.includes("implementation.png")
        ? { implementation_crop: path.join(artifactDir, "implementation.png") }
        : {}),
      ...(artifactNames.includes("side-by-side.png") ? { side_by_side: path.join(artifactDir, "side-by-side.png") } : {}),
    },
    diagnostics: [],
  })
}

test("provider-bound integrity run_command applies the default foreground timeout", async () => {
  await import("../../src/session/prompt")
  const { SessionLoop } = await import("../../src/session/loop")
  const { createIntegrityAcceptanceTools } = await import("../../src/integrity/acceptance-tools")
  const { Shell } = await import("../../src/shell/shell")
  const { DEFAULT_BASH_TIMEOUT_MS } = await import("../../src/shell/timeout")
  const dir = await tmpdir({ git: true })
  const calls: Array<{ command: string; timeoutMs?: number }> = []
  const originalRun = Shell.run

  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      Shell.run = async (command, opts = {}) => {
        calls.push({ command, timeoutMs: opts.timeoutMs })
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          timedOut: false,
          idleTimedOut: false,
          aborted: false,
          pid: 12345,
        }
      }
      try {
        const tools = createIntegrityAcceptanceTools({ taskID: "tsk_integrity_default_timeout" })
        const prepared = SessionLoop.prepareProviderTool({
          name: "run_command",
          source: "extra",
          model: {
            providerID: "alibaba-cn",
            id: "kimi-k2.5",
            api: { id: "kimi-k2.5" },
          } as any,
          tool: tools.run_command,
        }) as any

        await prepared.execute({ command: "printf ok" }, { toolCallId: "call_default_timeout" })
      } finally {
        Shell.run = originalRun
      }
    },
  })

  const foreground = calls.find((call) => call.command === "printf ok")
  expect(foreground?.timeoutMs).toBe(DEFAULT_BASH_TIMEOUT_MS)
}, 10_000)

test("integrity evidence tools expose scoped drilldown without upstream full-context", async () => {
  const { createIntegrityAcceptanceTools } = await import("../../src/integrity/acceptance-tools")
  const dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      const tools = createIntegrityAcceptanceTools({
        taskID: "tsk_integrity_tools",
        goals: [
          {
            id: "goal_api",
            title: "API integration",
            description: "Wire the migrated page to the real API client.",
            criteria: "full acceptance details should only appear in goal_detail when requested",
            priority: "blocking",
            acceptance_spec_count: 2,
            acceptance_scenarios: [],
            acceptance_specs: [],
            requirement_ids: ["REQ-1"],
            depends_on: [],
            owned_paths: ["src/features/orders/OrdersPage.tsx", "src/features/orders/api.ts"],
          },
        ],
        buildEvidence: {
          summary: "Changed the orders page and API integration.",
          changedFiles: ["src/features/orders/OrdersPage.tsx", "src/features/orders/api.ts", "src/shared/Button.tsx"],
          diffs: [
            {
              file: "src/features/orders/api.ts",
              before: "export const api = mockApi",
              after: "export const api = realApi",
              additions: 1,
              deletions: 1,
            },
          ],
          goalReports: [],
        },
        frontendDesign:
          "## visual_consistency_contract\nMatch web-clone-source/reference.png with measured overlay evidence.\n\n## evidence_source_manifest\nweb-clone-source/implementation-blueprint.md",
        visualEvidence: [
          visualBundle(
            "tsk_integrity_tools",
            dir.path,
            [
              await seedTaskWithReferenceComparison({
                taskID: "tsk_integrity_tools",
                projectDirectory: dir.path,
              }),
            ],
          ),
        ],
        attachments: [],
      })

      expect(Object.keys(tools)).not.toContain("inspect_acceptance_context")
      expect(Object.keys(tools)).not.toContain("edit_file")
      expect(Object.keys(tools)).not.toContain("write_file")
      expect(Object.keys(tools)).not.toContain("memory_write")
      expect(Object.keys(tools).some((name) => name.includes("review") && name !== "inspect_integrity_evidence")).toBe(
        false,
      )
      expect(Object.keys(tools)).toContain("inspect_integrity_evidence")
      expect(Object.keys(tools)).toContain("inspect_visual_evidence")
      expect(Object.keys(tools)).toContain("run_command")
      expect(Object.keys(tools)).toContain("read_file")
      expect(Object.keys(tools)).toContain("search_code")

      const directories = await tools.inspect_integrity_evidence.execute!(
        { section: "changed_directories", max_chars: 2_000 },
        {} as any,
      )
      expect(String(directories)).toContain("src/features/orders")
      expect(String(directories)).toContain("src/shared")
      expect(String(directories)).not.toContain("OrdersPage.tsx")

      const files = await tools.inspect_integrity_evidence.execute!(
        { section: "changed_files_in_directory", directory: "src/features/orders", max_chars: 2_000 },
        {} as any,
      )
      expect(String(files)).toContain("src/features/orders/OrdersPage.tsx")
      expect(String(files)).toContain("src/features/orders/api.ts")

      const diff = await tools.inspect_integrity_evidence.execute!(
        { section: "diff_for_file", file_path: "src/features/orders/api.ts", max_chars: 2_000 },
        {} as any,
      )
      expect(String(diff)).toContain("realApi")
      expect(String(diff)).not.toContain("upstream_context")

      const design = await tools.inspect_integrity_evidence.execute!(
        { section: "frontend_design_contract", max_chars: 2_000 },
        {} as any,
      )
      expect(String(design)).toContain("visual_consistency_contract")
      expect(String(design)).toContain("web-clone-source/implementation-blueprint.md")

      const visual = await tools.inspect_visual_evidence.execute!(
        { bundle_id: "veb_integrity_desktop", max_chars: 4_000 },
        {} as any,
      )
      expect(String(visual)).toContain("status=passing")
      expect(String(visual)).toContain("reference=webpage-evidence/reference.png")
      expect(String(visual)).toContain("rendered=webpage-evidence/rendered.png")
      expect(String(visual)).toContain("inspection_status=passing")
      expect(String(visual)).toContain("production_blockers=0")
      expect(String(visual)).toContain("project_directory=" + dir.path)
      expect(String(visual)).toContain("region_header")

      const command = await tools.run_command.execute!(
        { command: "printf guard > integrity-mutation.txt", timeout_ms: 10_000 },
        {} as any,
      )
      expect(String(command)).toContain("readonly_guard")
      expect(String(command)).toContain("integrity-mutation.txt")
    },
  })
}, 20_000)

test("integrity visual evidence reports missing reference-comparison refs as not passing", async () => {
  const { createIntegrityAcceptanceTools } = await import("../../src/integrity/acceptance-tools")
  const dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      const tools = createIntegrityAcceptanceTools({
        taskID: "tsk_integrity_visual_missing_ref",
        visualEvidence: [
          visualBundle("tsk_integrity_visual_missing_ref", dir.path, [
            "webpage-evidence/rendered.png",
            "visual-qa-report.json",
          ]),
        ],
      })

      const visual = await tools.inspect_visual_evidence.execute!(
        { bundle_id: "veb_integrity_desktop", max_chars: 4_000 },
        {} as any,
      )
      expect(String(visual)).toContain("status=not_passing")
      expect(String(visual)).toContain("missing browser_preview_evidence reference-comparison evidence ref")
    },
  })
}, 20_000)

test("integrity visual evidence reports zero required regions as not passing", async () => {
  const { createIntegrityAcceptanceTools } = await import("../../src/integrity/acceptance-tools")
  const dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      const tools = createIntegrityAcceptanceTools({
        taskID: "tsk_integrity_visual_zero_regions",
        visualEvidence: [visualBundleWithoutRequiredRegions("tsk_integrity_visual_zero_regions", dir.path)],
      })

      const visual = await tools.inspect_visual_evidence.execute!(
        { bundle_id: "veb_integrity_desktop", max_chars: 4_000 },
        {} as any,
      )
      expect(String(visual)).toContain("status=not_passing")
      expect(String(visual)).toContain("no required visual regions declared")
    },
  })
}, 20_000)

test("integrity visual evidence rejects mismatched comparison task, region, viewport, operation, and status", async () => {
  const { createIntegrityAcceptanceTools } = await import("../../src/integrity/acceptance-tools")
  const dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      const cases: Array<{
        name: string
        toolTaskID: string
        bundleTaskID: string
        evidenceID: string
        expected: string
      }> = []
      {
        const taskID = "tsk_integrity_visual_wrong_task_source"
        cases.push({
          name: "wrong task",
          toolTaskID: "tsk_integrity_visual_wrong_task_expected",
          bundleTaskID: taskID,
          evidenceID: await seedTaskWithReferenceComparison({ taskID, projectDirectory: dir.path }),
          expected: "does not match expected task",
        })
      }
      {
        const taskID = "tsk_integrity_visual_wrong_region"
        cases.push({
          name: "wrong region",
          toolTaskID: taskID,
          bundleTaskID: taskID,
          evidenceID: await seedTaskWithReferenceComparison({
            taskID,
            projectDirectory: dir.path,
            regionID: "region_footer",
          }),
          expected: "belongs to region region_footer",
        })
      }
      {
        const taskID = "tsk_integrity_visual_wrong_viewport"
        cases.push({
          name: "wrong viewport",
          toolTaskID: taskID,
          bundleTaskID: taskID,
          evidenceID: await seedTaskWithReferenceComparison({
            taskID,
            projectDirectory: dir.path,
            viewportID: "mobile",
          }),
          expected: "viewport is mobile, not desktop",
        })
      }
      {
        const taskID = "tsk_integrity_visual_preview_capture"
        cases.push({
          name: "preview capture",
          toolTaskID: taskID,
          bundleTaskID: taskID,
          evidenceID: await seedTaskWithReferenceComparison({
            taskID,
            projectDirectory: dir.path,
            operationKind: "preview-capture",
          }),
          expected: "is preview-capture, not reference-comparison",
        })
      }
      {
        const taskID = "tsk_integrity_visual_failed_status"
        cases.push({
          name: "failed status",
          toolTaskID: taskID,
          bundleTaskID: taskID,
          evidenceID: await seedTaskWithReferenceComparison({
            taskID,
            projectDirectory: dir.path,
            status: "failed",
          }),
          expected: "status is failed",
        })
      }

      for (const item of cases) {
        const tools = createIntegrityAcceptanceTools({
          taskID: item.toolTaskID,
          visualEvidence: [visualBundle(item.bundleTaskID, dir.path, [item.evidenceID])],
        })
        const visual = await tools.inspect_visual_evidence.execute!(
          { bundle_id: "veb_integrity_desktop", max_chars: 4_000 },
          {} as any,
        )
        expect(String(visual), item.name).toContain("status=not_passing")
        expect(String(visual), item.name).toContain(item.expected)
      }
    },
  })
}, 20_000)

test("integrity visual evidence rejects incomplete reference-comparison artifact sets", async () => {
  const { createIntegrityAcceptanceTools } = await import("../../src/integrity/acceptance-tools")
  const dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      const taskID = "tsk_integrity_visual_incomplete_artifacts"
      Database.use((db) =>
        db
          .insert(EngineTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            title: "Integrity visual evidence task",
            request: "Inspect malformed visual evidence",
            source: "test",
            time_created: Date.now(),
            time_updated: Date.now(),
          })
          .run(),
      )
      const artifactDir = ProjectRuntimePaths.taskAbsolute(dir.path, taskID, "bp", "integrity-incomplete")
      await fs.mkdir(artifactDir, { recursive: true })
      await fs.writeFile(path.join(artifactDir, "side-by-side.png"), "side-by-side")
      const target = await persistBrowserPreviewTarget({
        taskID,
        url: "http://127.0.0.1:4173/",
      })
      const evidenceID = "art_integrity_incomplete_reference_comparison"
      Database.use((db) =>
        db
          .insert(EngineArtifactTable)
          .values({
            id: evidenceID,
            task_id: taskID,
            run_id: null,
            goal_run_id: null,
            acceptance_id: null,
            kind: "browser_preview_evidence",
            label: "capture",
            payload: {
              target_id: target.id,
              viewport_id: "desktop",
              operation_kind: "reference-comparison",
              region_id: "region_header",
              artifact_paths: {
                side_by_side: ProjectRuntimePaths.taskRelative(
                  taskID,
                  "bp",
                  "integrity-incomplete",
                  "side-by-side.png",
                ),
              },
              status: "passed",
              summary: "Incomplete reference comparison should be unreadable.",
              diagnostics: [],
              time_completed: Date.now(),
            },
            time_created: Date.now(),
            time_updated: Date.now(),
          })
          .run(),
      )
      const tools = createIntegrityAcceptanceTools({
        taskID,
        visualEvidence: [visualBundle(taskID, dir.path, [evidenceID])],
      })

      const visual = await tools.inspect_visual_evidence.execute!(
        { bundle_id: "veb_integrity_desktop", max_chars: 4_000 },
        {} as any,
      )
      expect(String(visual)).toContain("status=not_passing")
      expect(String(visual)).toContain("was not found or has unreadable artifacts")
    },
  })
}, 20_000)

test("integrity run_command filters evidence input views from readonly guard but keeps implementation mutations", async () => {
  const { createIntegrityAcceptanceTools } = await import("../../src/integrity/acceptance-tools")
  const dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      const tools = createIntegrityAcceptanceTools({ taskID: "tsk_integrity_guard_filter" })

      const evidenceOnly = await tools.run_command.execute!(
        {
          command: "mkdir -p web-clone-source && printf evidence > web-clone-source/reference.txt",
          timeout_ms: 10_000,
        },
        {} as any,
      )
      expect(String(evidenceOnly)).not.toContain("readonly_guard")

      const implementationMutation = await tools.run_command.execute!(
        {
          command: "mkdir -p src && printf implementation > src/changed.txt",
          timeout_ms: 10_000,
        },
        {} as any,
      )
      expect(String(implementationMutation)).toContain("readonly_guard")
      expect(String(implementationMutation)).toContain("src/changed.txt")
      expect(String(implementationMutation)).not.toContain("web-clone-source/reference.txt")
    },
  })
}, 20_000)

test("integrity run_command can launch a background preview command with a lease", async () => {
  const { createIntegrityAcceptanceTools } = await import("../../src/integrity/acceptance-tools")
  const dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      const tools = createIntegrityAcceptanceTools({ taskID: "tsk_integrity_background" })
      const output = await tools.run_command.execute!(
        {
          command: `bun -e "console.log('http://127.0.0.1:32123'); setInterval(() => {}, 1000)"`,
          timeout_ms: 3_000,
          background: true,
        },
        {} as any,
      )
      expect(String(output)).toContain("background: true")
      expect(String(output)).toContain("pid:")
      expect(String(output)).toContain("url: http://127.0.0.1:32123")
      expect(String(output)).toContain("lease_timeout_ms: 3000")
    },
  })
}, 30_000)
