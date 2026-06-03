import { describe, expect, test } from "bun:test"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")

const workerAgentFiles = [
  "packages/opencorvus/src/intent-analysis/agent.ts",
  "packages/opencorvus/src/requirements/agent.ts",
  "packages/opencorvus/src/frontend-design/agent.ts",
  "packages/opencorvus/src/build/agent.ts",
  "packages/opencorvus/src/integrity/team-agent.ts",
]

const forbiddenVisibleBriefSnippets = [
  "Analyze the request. Emit extract_slot / flag_missing_info",
  "StructuredOutput tool exactly once",
  "Call register_requirement per REQ-N entry",
  "Then call submit_requirements",
  "call report_build_result exactly once",
  "Final Output (REQUIRED)",
  "submit_acceptance_verdict tool exactly once",
  "For EACH dimension call its own",
  "submit_<dimension_id>_verdict` tool exactly once",
  "Call retired_metric_probe first",
]

describe("worker agent visible briefs", () => {
  test("do not embed internal tool protocol instructions in orchestrator-authored user messages", async () => {
    for (const rel of workerAgentFiles) {
      const text = await Bun.file(path.join(repoRoot, rel)).text()
      for (const snippet of forbiddenVisibleBriefSnippets) {
        expect(text.includes(snippet), `${rel} contains visible protocol snippet: ${snippet}`).toBe(false)
      }
    }
  })
})
