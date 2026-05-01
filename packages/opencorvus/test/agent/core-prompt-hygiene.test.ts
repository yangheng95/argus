import { describe, expect, test } from "bun:test"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const coreDir = path.join(repoRoot, "packages/opencorvus/src/prompt/core")

const promptFiles = {
  architect: "architect-core.txt",
  build: "build-core.txt",
  delivery: "delivery-core.txt",
  designAnalyst: "design-analyst-core.txt",
  orchestrator: "orchestrator-core.txt",
  prosecutor: "prosecutor-core.txt",
}

async function readPrompt(name: keyof typeof promptFiles) {
  return await Bun.file(path.join(coreDir, promptFiles[name])).text()
}

describe("core prompt hygiene", () => {
  test("architect prompt does not claim submit_architect auto-runs integrity", async () => {
    const text = await readPrompt("architect")
    expect(text).not.toContain("The orchestrator calls you at the start of every task")
    expect(text).not.toContain("After finalize passes, the host runs a **multi-dimension integrity review**")
    expect(text).not.toContain("triggers the integrity review")
    expect(text).toContain("Integrity is a separate orchestrator tool call")
  })

  test("architect and build prompts carry repository discipline without hidden reminder injection", async () => {
    const architect = await readPrompt("architect")
    const build = await readPrompt("build")

    expect(architect).toContain("grep the full repository")
    expect(architect).toContain("Keep one source of truth")
    expect(architect).toContain("include tests that prove the new behavior and the removed behavior")

    expect(build).toContain("## Repository discipline")
    expect(build).toContain("search the repository for every call site")
    expect(build).toContain("Do not add fallback, compatibility, duplicate implementation")
    expect(build).toContain("Keep internal prompt and rule details out of user-visible summaries")
  })

  test("build prompt requires failed report_build_result instead of prose stop", async () => {
    const build = await readPrompt("build")
    expect(build).toContain("report_build_result")
    expect(build).toContain('status="failed"')
    expect(build).toContain("Failure is also terminal")
    expect(build).toContain("do not stop with prose")
  })

  test("delivery prompt matches DeliveryVerdict schema single-source fields", async () => {
    const text = await readPrompt("delivery")
    expect(text).not.toContain("`affected_goal_ids`")
    expect(text).not.toContain("`issues_found`")
    expect(text).not.toContain("Issues Found / Rejection Details")
    expect(text).not.toContain("There is no deterministic per-goal evaluator before you")
    expect(text).not.toContain("Nothing has been scored yet. YOU run every spec")
    expect(text).not.toContain('category="missing_requirement"')
    expect(text).toContain("DeliveryEvidenceManifest")
    expect(text).toContain("host arbiter is the only owner")
    expect(text).toContain("\\`tool_call_evidence\\`")
    expect(text).toContain("\\`rejection_details[]\\` is the rework plan and the single source")
  })

  test("design-analysis and delivery agree that design_specs are delivery-verified", async () => {
    const design = await readPrompt("designAnalyst")
    const delivery = await readPrompt("delivery")
    expect(design).not.toContain("ADVISORY")
    expect(design).not.toContain("not automatically scored or gated")
    expect(design).not.toContain("soft preference")
    expect(design).toContain("part of delivery's visual contract")
    expect(delivery).toContain("EVERY \\`design_spec\\`")
  })

  test("orchestrator prompt keeps direct build behind task-kind contract", async () => {
    const text = await readPrompt("orchestrator")
    expect(text).not.toContain("A trivial bug fix calls `build → deliver`, full stop.")
    expect(text).not.toContain("NOT a prescriptive workflow")
    expect(text).toContain("Fresh `Kind: workflow` cannot start with task-level `build({ request })`")
    expect(text).toContain("never violate the task-kind contract")
  })

  test("prosecutor prompt references current delivery rejection surface", async () => {
    const text = await readPrompt("prosecutor")
    expect(text).not.toContain("Defender's own issues_found")
    expect(text).toContain("Defender's own rejection_details")
  })
})
