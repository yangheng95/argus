import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const component = readFileSync(join(import.meta.dir, "..", "src", "components", "IntegrityCard.tsx"), "utf8")
const css = readFileSync(join(import.meta.dir, "..", "src", "styles", "surfaces", "inspector.css"), "utf8")

test("integrity reviewers render as distinct reviewer blocks", () => {
  expect(component).toContain("function ReviewerCard")
  expect(component).toContain('class="integrity__reviewer"')
  expect(component).toContain("data-verdict={props.reviewer.verdict}")
  expect(component).toContain('class="integrity__reviewer-name"')
  expect(component).toContain('class="integrity__reviewer-summary"')
  expect(component).toContain("integrity.reviewer_evidence")
  expect(css).toContain(".integrity__reviewer-list")
  expect(css).toContain('.integrity__reviewer[data-verdict="pass"]')
  expect(css).toContain('.integrity__reviewer[data-verdict="needs_correction"]')
})

test("integrity full team report is mounted only after details opens", () => {
  expect(component).toContain("function IntegrityTeamReport")
  expect(component).toContain("const [open, setOpen] = createSignal(false)")
  expect(component).toContain("<Show when={open()}>")
  expect(component).toContain('<pre class="integrity__report">{props.markdown}</pre>')
  expect(component).not.toContain('<pre class="integrity__report">{props.integrity.teamReportMarkdown}</pre>')
  expect(css).toContain(".integrity__report-detail")
  expect(css).toContain(".integrity__report-summary")
})
