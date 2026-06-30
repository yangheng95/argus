import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { ProjectTable } from "../../src/project/project.sql"
import { Instance } from "../../src/project/instance"
import { Database } from "../../src/storage/db"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { composeLatestAcceptanceFeedbackForBuild } from "../../src/orchestrator/tools"
import { createDecisionLog } from "../../src/decision-log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import type { AcceptanceEvidenceManifest } from "../../src/acceptance/manifest"

describe("orchestrator build feedback context", () => {
  let tmp: Awaited<ReturnType<typeof tmpdir>>

  beforeEach(async () => {
    await resetDatabase()
    tmp = await tmpdir()
  })

  afterEach(async () => {
    await resetDatabase()
    await tmp?.[Symbol.asyncDispose]?.()
  })

  test("hydrates build retry feedback directly from persisted acceptance artifacts", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const suffix = now.toString(16)
        const projectID = `proj_feedback_${suffix}`
        const taskID = `tsk_feedback_${suffix}`
        const runID = `run_feedback_${suffix}`
        const acceptanceID = `del_feedback_${suffix}`
        const verdictID = `art_verdict_${suffix}`
        const manifestID = `art_manifest_${suffix}`
        const goalID = `gol_feedback_${suffix}`

        const manifest: AcceptanceEvidenceManifest = {
          id: manifestID,
          taskId: taskID,
          runId: runID,
          acceptanceId: acceptanceID,
          iteration: 2,
          requiredChecks: [],
          checkResults: [],
          goalCoverage: [],
          requirementCoverage: [],
          reviewEvidence: [
            {
              id: "review:contract_audit",
              name: "Contract audit",
              status: "failed",
              verdict: "failed",
              evidence: ["missing exported contract consumed by the runtime surface"],
            },
          ],
          changedFiles: ["src/index.html"],
          evidenceDecision: {
            status: "failed",
            summary: "Acceptance evidence failed.",
            failedCheckIds: [],
            failedCoverageIds: [],
            failedReviewIds: ["review:contract_audit"],
          },
          timeCreated: now,
        }

        Database.use((db) => {
          db.insert(ProjectTable)
            .values({
              id: projectID,
              worktree: tmp.path,
              name: "Feedback context",
              sandboxes: [],
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: projectID,
              source: "test",
              title: "Feedback context",
              request: "fix rejected acceptance",
              kind: "workflow",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run()
          db.insert(EngineArtifactTable)
            .values({
              id: manifestID,
              task_id: taskID,
              run_id: runID,
              acceptance_id: acceptanceID,
              kind: "acceptance_evidence_manifest",
              label: "acceptance-evidence-manifest",
              payload: manifest,
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(EngineArtifactTable)
            .values({
              id: verdictID,
              task_id: taskID,
              run_id: runID,
              acceptance_id: acceptanceID,
              kind: "verdict",
              label: "acceptance-review-verdict",
              payload: {
                verdict: "rejected",
                summary: "Calculator render rejected by acceptance evidence.",
                rejection_details: [
                  {
                    goal_id: goalID,
                    category: "quality",
                    error: "missing exported contract consumed by the calculator surface",
                    file: "src/index.html",
                    suggestion: "Expose the exact contract evidence to the executor.",
                  },
                  {
                    category: "review",
                    error: "contract audit found a missing exported surface",
                    suggestion: "Route the acceptance contract failure directly into build feedback.",
                  },
                ],
              },
              time_created: now + 1,
              time_updated: now + 1,
            })
            .run()
        })

        const taskScopeFeedback = await composeLatestAcceptanceFeedbackForBuild({ taskID })
        expect(taskScopeFeedback).toContain("Acceptance review rejected the integrated deliverable")
        expect(taskScopeFeedback).toContain("review:contract_audit")
        expect(taskScopeFeedback).toContain("missing exported contract consumed by the calculator surface")
        expect(taskScopeFeedback).not.toContain("Canonical acceptance feedback packet")
        expect(taskScopeFeedback).not.toContain("all_rejection_detail_count")

        const goalScopeFeedback = await composeLatestAcceptanceFeedbackForBuild({ taskID, goalID })
        expect(goalScopeFeedback).toContain(`goal_id: ${goalID}`)
        expect(goalScopeFeedback).toContain("missing exported contract consumed by the calculator surface")
        expect(goalScopeFeedback).not.toContain("contract audit found a missing exported surface")
      },
    })
  })

  test("hydrates build retry feedback from latest failed visual QA problem DOM report", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const suffix = now.toString(16)
        const projectID = `proj_visual_qa_feedback_${suffix}`
        const taskID = `tsk_visual_qa_feedback_${suffix}`

        Database.use((db) => {
          db.insert(ProjectTable)
            .values({
              id: projectID,
              worktree: tmp.path,
              name: "Visual QA feedback context",
              sandboxes: [],
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: projectID,
              source: "test",
              title: "Visual QA feedback context",
              request: "repair rejected visual QA DOM region",
              kind: "workflow",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run()
        })

        createDecisionLog(taskID).append({
          phase: "visual_qa",
          key: `report_${now}`,
          value: JSON.stringify(
            {
              report: {
                accepted: false,
                summary: "Hero module overlaps the navigation in the local implementation.",
                coverage: [
                  {
                    region: "top viewport",
                    viewports: [{ width: 1440, height: 900 }],
                    states: ["default"],
                    source_refs: ["browser_preview_reference_regions"],
                    evidence_refs: ["screenshot://local/top-viewport.png"],
                    notes: "Compared the local top viewport against the reference.",
                  },
                ],
                findings: [],
                production_blockers: [
                  {
                    id: "blocker-hero-overlap",
                    principle_ids: ["reference-structure"],
                    region: "hero navigation boundary",
                    reason: "The hero module starts under the sticky navigation and hides the tab row.",
                    impact: "Users cannot scan the first market category tabs reliably.",
                    required_correction: "Restore the hero container top spacing and tab row flow.",
                    source_refs: ["browser_preview_reference_regions"],
                    evidence_refs: ["screenshot://local/top-viewport.png"],
                  },
                ],
                unresolved_code_module_problems: [],
                problem_dom_regions: [
                  {
                    id: "dom-hero-tabs",
                    blocker_ids: ["blocker-hero-overlap"],
                    region: "hero navigation boundary",
                    route: "/markets/indices/",
                    viewport: { width: 1440, height: 900 },
                    locator: "main [data-testid=\"hero-tabs\"]",
                    dom_path: "body > div#root > main > section.market-hero > nav.hero-tabs",
                    outer_html_excerpt:
                      "<nav data-testid=\"hero-tabs\" class=\"hero-tabs is-clipped\">US stocks Futures Forex</nav>",
                    ancestor_context: ["section.market-hero class=market-hero is-overlapping"],
                    sibling_context: ["h1 United States", "div.major-indices"],
                    text_content: "US stocks Futures Forex",
                    role: "navigation",
                    accessible_name: "Market categories",
                    bbox: { x: 0, y: 188, width: 1440, height: 32 },
                    computed_style: {
                      display: "flex",
                      overflow: "hidden",
                      "margin-top": "-32px",
                    },
                    attributes: {
                      class: "hero-tabs is-clipped",
                      "data-testid": "hero-tabs",
                    },
                    code_search_terms: ["hero-tabs", "market-hero", "is-clipped"],
                    evidence_refs: ["screenshot://local/top-viewport.png"],
                    notes: "Build should inspect the hero tab container spacing before repainting adjacent modules.",
                  },
                ],
                repairs: [],
                evidence: [
                  {
                    type: "screenshot",
                    ref: "screenshot://local/top-viewport.png",
                    viewport: { width: 1440, height: 900 },
                    state: "default",
                    note: "Local implementation screenshot with clipped hero tabs.",
                  },
                ],
                reference_parity: {
                  required: true,
                  required_regions: ["top viewport"],
                  reference_comparison_evidence_refs: ["browser_preview_reference_regions"],
                  missing_regions: [],
                  blocker_ids: ["blocker-hero-overlap"],
                },
                commands: [],
                changed_files: [],
                open_questions: [],
                fact_check_items: [],
              },
              acceptance: {
                submittedAccepted: false,
                effectiveAccepted: false,
                selfReportIssues: [],
                blockingIssues: ["Visual QA reported blocker-hero-overlap."],
              },
            },
            null,
            2,
          ),
          reason: "Dedicated frontend GUI and functional QA report from session ses_visual_qa_feedback",
        })

        const feedback = await composeLatestAcceptanceFeedbackForBuild({ taskID })

        expect(feedback).toContain("Latest failed Visual QA report for Build repair")
        expect(feedback).toContain("problem_dom_regions: 1")
        expect(feedback).toContain("blocker-hero-overlap")
        expect(feedback).toContain('locator: main [data-testid="hero-tabs"]')
        expect(feedback).toContain('outer_html_excerpt: <nav data-testid="hero-tabs"')
        expect(feedback).toContain("computed_style: display=flex; overflow=hidden; margin-top=-32px")
        expect(feedback).toContain("code_search_terms: hero-tabs, market-hero, is-clipped")
      },
    })
  })
})
