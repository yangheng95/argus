import { expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

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
          "## visual_consistency_contract\nMatch web-clone-source/reference.png at 96/100.\n\n## evidence_source_manifest\nweb-clone-source/implementation-blueprint.md",
        attachments: [],
      })

      expect(Object.keys(tools)).not.toContain("inspect_delivery_context")
      expect(Object.keys(tools)).not.toContain("edit_file")
      expect(Object.keys(tools)).not.toContain("write_file")
      expect(Object.keys(tools)).not.toContain("memory_write")
      expect(Object.keys(tools)).not.toContain("run_integrity_review")
      expect(Object.keys(tools)).toContain("inspect_integrity_evidence")
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

      const command = await tools.run_command.execute!(
        { command: "printf guard > integrity-mutation.txt", timeout_ms: 10_000 },
        {} as any,
      )
      expect(String(command)).toContain("readonly_guard")
      expect(String(command)).toContain("integrity-mutation.txt")
    },
  })
})
