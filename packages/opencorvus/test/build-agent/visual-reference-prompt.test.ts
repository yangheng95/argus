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
      { mime: "text/markdown", filename: "template.md", size: 2, sha: "t1" },
    ])
    expect(out).toContain("ui.png")
    // Markdown is read via read_attachment / inline-into-request, not a
    // visual contract — must not be promoted to "binding visual target".
    expect(out).not.toContain("template.md")
  })

  test("falls back to sha when filename is missing", () => {
    const out = renderVisualContractPreamble([
      { mime: "image/png", size: 1, sha: "deadbeef0123" },
    ])
    expect(out).toContain("deadbeef0123")
  })

  test("inlined mode (default): tells the LLM file parts are inlined above", () => {
    const out = renderVisualContractPreamble(
      [{ mime: "image/png", filename: "ui.png", size: 1, sha: "v" }],
      { mode: "inlined" },
    )
    expect(out).toContain("inlined above as multimodal parts")
    // Inlined mode talks about "file part decode failure", not "missing on disk".
    expect(out).toContain("inlined file part")
    expect(out).not.toContain("missing on disk")
  })

  test("staged-only mode (external provider): tells the LLM to read from disk", () => {
    const out = renderVisualContractPreamble(
      [{ mime: "image/png", filename: "ui.png", size: 1, sha: "v" }],
      { mode: "staged-only" },
    )
    expect(out).toContain("staged on disk")
    expect(out).toContain("references/")
    // The wording must NOT promise inlining — codex / claude-code don't
    // get multimodal file parts, and a "look above" claim would be a lie
    // that the model would trust.
    expect(out).not.toContain("inlined above as multimodal parts")
    // Must still demand fail-loud on missing file.
    expect(out).toContain("missing on disk")
    expect(out).toContain("report_build_result")
  })

  /**
   * Spec: acceptance-attachment-store-single-source-2026-05-11.md (companion
   * to the `InlineBase64InPartError` session.updatePart guard). The host
   * gate is rule-6.1 second branch (data integrity) and is permanent; the
   * preamble carries rule-6.1 first branch (prompt-side correction) so the
   * build LLM never reaches for `data:image/...;base64,...` when emitting
   * code. Bench evidence: build agent generated PowerShell that inlined a
   * PNG as `<image href="data:image/png;base64,$pngBase64" .../>` into an
   * SVG; the gate caught it but the goal still failed retries.
   */
  describe("inline-base64 ban (rule 6.1 first branch)", () => {
    const fixtures = [
      { mode: "inlined" as const, label: "inlined mode" },
      { mode: "staged-only" as const, label: "staged-only mode" },
    ]
    for (const { mode, label } of fixtures) {
      test(`${label}: forbids inlining staged assets as data:...;base64,... URLs`, () => {
        const out = renderVisualContractPreamble(
          [{ mime: "image/png", filename: "hero.png", size: 1, sha: "v" }],
          { mode },
        )
        // Explicit ban on the regression shape.
        expect(out).toContain("data:")
        expect(out).toContain("base64")
        expect(out).toContain("Never inline")
        // Names the host-side counterpart so the LLM understands both
        // branches enforce the same invariant.
        expect(out).toContain("InlineBase64InPartError")
      })

      test(`${label}: instructs the LLM to reference files by relative path`, () => {
        const out = renderVisualContractPreamble(
          [{ mime: "image/png", filename: "hero.png", size: 1, sha: "v" }],
          { mode },
        )
        // Positive guidance: use the staged relative path, not raw bytes.
        expect(out).toContain("references/<filename>")
        // Concrete reference example so the LLM has a shape to copy.
        expect(out).toContain('src="references/foo.png"')
      })
    }
  })
})
