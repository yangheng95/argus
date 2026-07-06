import { afterEach, beforeEach, expect, test } from "bun:test"
import { createDecisionLog } from "../../src/decision-log"
import { renderFrontendDesignHandoffReference } from "../../src/frontend-design/handoff"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { ProjectTable } from "../../src/project/project.sql"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

let tmp: Awaited<ReturnType<typeof tmpdir>>
let taskID = ""
let projectID = ""

beforeEach(async () => {
  await resetDatabase()
  tmp = await tmpdir()
  const stamp = Date.now().toString(16)
  taskID = `tsk_handoff_${stamp}`
  projectID = `project_handoff_${stamp}`
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(ProjectTable)
      .values({
        id: projectID,
        worktree: tmp.path,
        name: "handoff test",
        sandboxes: [],
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
  Database.use((db) =>
    db
      .insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "handoff test",
        request: "clone a reference page",
        priority: "normal",
        time_created: now,
        time_updated: now,
        time_started: now,
      })
      .run(),
  )
})

afterEach(async () => {
  await resetDatabase()
  await tmp?.[Symbol.asyncDispose]?.()
})

test("frontend-design handoff is empty before canonical decision-log entries exist", async () => {
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect(renderFrontendDesignHandoffReference(taskID)).toBe("")
      expect(renderFrontendDesignHandoffReference(taskID, { includeExcerpts: false })).toBe("")
      expect(renderFrontendDesignHandoffReference(taskID, { pathMode: "absolute" })).toBe("")
    },
  })
})

test("frontend-design handoff stays empty when only reference artifacts exist", async () => {
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      createDecisionLog(taskID).append({
        phase: "frontend_design",
        key: "reference_artifacts",
        value: "visual-html-skeleton/screenshots/desktop.png",
        reason: "visual qa reference artifact only",
      })

      expect(renderFrontendDesignHandoffReference(taskID)).toBe("")
      expect(renderFrontendDesignHandoffReference(taskID, { includeExcerpts: false })).toBe("")
      expect(renderFrontendDesignHandoffReference(taskID, { pathMode: "absolute" })).toBe("")
    },
  })
})

test("frontend-design handoff points to source files and keeps excerpts bounded", async () => {
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const longSpec = "A".repeat(2_000)
      const log = createDecisionLog(taskID)
      log.append({
        phase: "frontend_design",
        key: "public_report",
        value:
          "## Quality Project Contract\nBuild semantic React source from the source skeleton and preserved CSS sidecars.",
        reason: "public terminal report",
      })
      log.append({
        phase: "frontend_design",
        key: "visual_consistency_contract",
        value: longSpec,
        reason: "webpage-evidence-derived visual contract",
      })
      log.append({
        phase: "frontend_design",
        key: "quality_project_contract",
        value: "Source-region traceable refactor: every component maps back to captured source nodes and screenshots.",
        reason: "maintainable target",
      })
      log.append({
        phase: "frontend_design",
        key: "final_acceptance_mode",
        value: "maintainable_replacement_required",
        reason: "maintainable mode",
      })
      log.append({
        phase: "frontend_design",
        key: "frontend_project",
        value: JSON.stringify(
          {
            status: "created",
            role: "source_baseline_input",
            project_root: "frontend-design-skeleton",
            source_package: "web-clone-source",
            entrypoints: ["frontend-design-skeleton/index.html"],
            generation_tool: "source-skeleton",
            notes: [],
          },
          null,
          2,
        ),
        reason: "source skeleton role",
      })
      log.append({
        phase: "frontend_design",
        key: "evidence_source_manifest",
        value: "webpage-evidence/reference.png\nwebpage-evidence/page.ir.json",
        reason: "source manifest",
      })
      log.append({
        phase: "frontend_design",
        key: "visual_region_bindings",
        value: JSON.stringify(
          [
            {
              version: 1,
              purpose: "visual-region-binding-package",
              generated_at: "2026-07-05T00:00:00.000Z",
              manifest_path: "docs/visual-region-binding.json",
              source_image: "web-clone-source/reference.png",
              source_image_dimensions: { width: 400, height: 300 },
              slicing_strategy: "horizontal_component_bands",
              crop_directory: ".opencorvus/r/t/tsk_handoff/fd/visual-region-bindings/world",
              bbox_overlay_artifact:
                ".opencorvus/r/t/tsk_handoff/fd/visual-region-bindings/world/bbox-overlay__src400x300.png",
              contact_sheet_artifact:
                ".opencorvus/r/t/tsk_handoff/fd/visual-region-bindings/world/region-contact-sheet__src400x300.png",
              regions: [
                {
                  region_id: "header",
                  source_order: 1,
                  source_bbox: { x: 0, y: 0, width: 400, height: 120 },
                  viewport: "desktop",
                  region_scope: "top navigation and hero header",
                  crop_intent: "full-region",
                  target_route: "/",
                  implementation_locator: "header.site-header",
                  component_files: ["src/components/Header.tsx"],
                  reference_region_key: "header@desktop",
                  source_reference_artifact:
                    ".opencorvus/r/t/tsk_handoff/fd/visual-region-bindings/world/01-header__desktop__x0-y0-w400-h120.png",
                  source_crop_filename: "01-header__desktop__x0-y0-w400-h120.png",
                },
              ],
            },
          ],
          null,
          2,
        ),
        reason: "structured crop manifest rows",
      })

      const handoff = renderFrontendDesignHandoffReference(taskID, { valueCap: 120 })
      const guidanceOnly = handoff.slice(0, handoff.indexOf("### Compact Decision-Log Excerpts"))

      expect(handoff).toContain("Frontend Design Public Report")
      expect(handoff).toContain("frontend_design public report")
      const paths = ProjectRuntimePaths.frontendDesignPaths("", taskID)
      expect(handoff).toContain(paths.templateRelative)
      expect(handoff).toContain(paths.manifestRelative)
      expect(handoff).toContain("do not run webpage evidence tools outside frontend_design")
      expect(handoff).toContain("public_report")
      expect(handoff).toContain("visual_consistency_contract")
      expect(handoff).toContain("Visual Region Binding Crop Manifests")
      expect(handoff).toContain("docs/visual-region-binding.json")
      expect(handoff).toContain("header@desktop")
      expect(handoff).toContain("quality_project_contract")
      expect(handoff).toContain("frontend_project")
      expect(handoff).toContain("source_baseline_input")
      expect(handoff).toContain("Source-Region Refactor Guidance")
      expect(guidanceOnly).not.toContain("source_baseline_input skeleton")
      expect(handoff).toContain("rawproject evidence")
      expect(handoff).toContain("source data extraction")
      expect(handoff).toContain("rendered screenshot review evidence")
      expect(handoff).toContain("source-evidence review facts")
      expect(handoff).toContain("Do not change other agent prompts or communication paths")
      expect(handoff).toContain(
        "do not delete `web-clone-source/` content until source-derived style evidence and styling obligations have been migrated",
      )
      expect(handoff).not.toContain("freehand")
      expect(handoff).not.toContain("greenfield")
      expect(handoff).not.toContain("100/100")
      expect(handoff).not.toContain("overallScore >=80/100")
      expect(handoff).toContain("[+")
      expect(handoff.length).toBeLessThan(4_200)
    },
  })
})

test("frontend-design goal-scoped handoff does not expose full-page source manifest refs", async () => {
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const log = createDecisionLog(taskID)
      log.append({
        phase: "frontend_design",
        key: "public_report",
        value: "Frontend design public report exists for goal scoped build.",
        reason: "public terminal report",
      })
      log.append({
        phase: "frontend_design",
        key: "evidence_source_manifest",
        value: "web-clone-source/reference.png\nweb-clone-source/source-ir/component-tree.json",
        reason: "source manifest",
      })

      const handoff = renderFrontendDesignHandoffReference(taskID, {
        includeExcerpts: false,
        pathMode: "absolute",
        projectDir: tmp.path,
        goalScopedBuild: true,
      })
      const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)

      expect(handoff).toContain(paths.templateAbsolute)
      expect(handoff).toContain(
        "Goal-scoped Build visual targets come only from Architect reference_coverage crop rows",
      )
      expect(handoff).not.toContain(paths.manifestAbsolute)
      expect(handoff).not.toContain("web-clone-source/reference.png")
      expect(handoff).not.toContain("### Compact Decision-Log Excerpts")
    },
  })
})
