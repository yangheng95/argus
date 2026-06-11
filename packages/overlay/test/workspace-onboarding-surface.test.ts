import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const OVERLAY_ROOT = join(import.meta.dir, "..")
const source = readFileSync(join(OVERLAY_ROOT, "src/styles/surfaces/workspace-onboarding.css"), "utf8")
const component = readFileSync(join(OVERLAY_ROOT, "src/components/WorkspaceOnboardingDialog.tsx"), "utf8")

test("workspace onboarding surface stays flat and non-semantic", () => {
  expect(source).not.toMatch(/linear-gradient/i)
  expect(source).not.toMatch(/var\(--good\)/)
  expect(source).toMatch(/\.workspace-onboarding-recent\s*\{[\s\S]*border:/)
  expect(source).toMatch(/\.workspace-onboarding-action\[data-busy="true"\]\s*\{/)
})

test("workspace onboarding lists discovered projects before recent directories", () => {
  expect(component).toContain("loadDiscoveredProjects")
  expect(component).toContain('t("cwd.detected_projects")')
  expect(component).toContain('data-testid={`workspace-onboarding-detected-${index()}`}')
  expect(component).toContain("setDirectory(project.directory)")
  expect(component.indexOf('t("cwd.detected_projects")')).toBeLessThan(
    component.indexOf('t("workspace_onboarding.recent_title")'),
  )
})
