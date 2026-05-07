import { describe, expect, test } from "bun:test"
import { renderVisualContractPreamble } from "../../src/build/agent"

/**
 * Spec: overlay-image-ingestion-fidelity-2026-05-07.md §Fix D.
 *
 * The build agent's user prompt prepends an UNCONDITIONAL visual-contract
 * preamble whenever this dispatch carries multimodal references. The static
 * system prompt's reference-fidelity language is conditional ("If the prompt
 * depends on screenshots…"), and reasoning models routinely judge their way
 * out of the condition; the preamble eliminates that judgement call by
 * declaring restoration is mandatory whenever the branch fires.
 *
 * The preamble must NOT fire when there are no attachments — emitting it
 * unconditionally would teach the agent to expect references that aren't
 * there and trigger spurious INFORMATION MISSING reports.
 */
describe("renderVisualContractPreamble", () => {
  test("returns empty string when no attachments are provided", () => {
    expect(renderVisualContractPreamble([])).toBe("")
  })

  test("returns empty string when attachments contain no image / pdf", () => {
    const out = renderVisualContractPreamble([
      { mime: "text/plain", filename: "notes.txt", size: 42, sha: "abc" },
      { mime: "application/json", filename: "config.json", size: 100, sha: "def" },
    ])
    expect(out).toBe("")
  })

  test("renders preamble + filename for a single image attachment", () => {
    const out = renderVisualContractPreamble([
      { mime: "image/png", filename: "ainvest-target.png", size: 12345, sha: "sha1" },
    ])
    expect(out).toContain("## Visual Reference Contract (binding for this dispatch)")
    expect(out).toContain("ainvest-target.png")
    expect(out).toContain("image/png")
    expect(out).toContain("12345 bytes")
    expect(out).toContain("1:1")
    expect(out).toContain("NOT inspiration")
    expect(out).toContain("NOT optional")
    // Must instruct fail-loud path when the model can't read pixels.
    expect(out).toContain("report_build_result")
  })

  test("lists every visual attachment when multiple are passed", () => {
    const out = renderVisualContractPreamble([
      { mime: "image/png", filename: "hero.png", size: 100, sha: "h1" },
      { mime: "image/jpeg", filename: "detail.jpg", size: 200, sha: "h2" },
      { mime: "application/pdf", filename: "spec.pdf", size: 300, sha: "h3" },
    ])
    expect(out).toContain("hero.png")
    expect(out).toContain("detail.jpg")
    expect(out).toContain("spec.pdf")
  })

  test("filters out non-visual attachments while keeping visual ones", () => {
    const out = renderVisualContractPreamble([
      { mime: "image/png", filename: "ui.png", size: 1, sha: "v1" },
      { mime: "text/markdown", filename: "PRD.md", size: 2, sha: "t1" },
    ])
    expect(out).toContain("ui.png")
    // Markdown is read via read_attachment / inline-into-request, not a
    // visual contract — must not be promoted to "binding visual target".
    expect(out).not.toContain("PRD.md")
  })

  test("falls back to sha when filename is missing", () => {
    const out = renderVisualContractPreamble([
      { mime: "image/png", size: 1, sha: "deadbeef0123" },
    ])
    expect(out).toContain("deadbeef0123")
  })
})
