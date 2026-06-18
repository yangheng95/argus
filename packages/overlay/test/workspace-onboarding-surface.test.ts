import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { loadWorkspaceOnboardingDiscovery } from "../src/services/workspace-onboarding-discovery"
import { installRealOverlayI18n } from "./fixtures/i18n"

const OVERLAY_ROOT = join(import.meta.dir, "..")
const source = readFileSync(join(OVERLAY_ROOT, "src/styles/surfaces/workspace-onboarding.css"), "utf8")
const component = readFileSync(join(OVERLAY_ROOT, "src/components/WorkspaceOnboardingDialog.tsx"), "utf8")

installRealOverlayI18n()

test("workspace onboarding surface stays flat and non-semantic", () => {
  expect(source).not.toMatch(/linear-gradient/i)
  expect(source).not.toMatch(/var\(--good\)/)
  expect(source).toMatch(/\.workspace-onboarding-recent\s*\{[\s\S]*border:/)
  expect(source).toMatch(/\.workspace-onboarding-action\[data-busy="true"\]\s*\{/)
})

test("workspace onboarding lists discovered projects before recent directories", () => {
  expect(component).toContain("loadWorkspaceOnboardingDiscovery")
  expect(component).toContain('t("cwd.detected_projects")')
  expect(component).toContain("data-testid={`workspace-onboarding-detected-${index()}`}")
  expect(component).toContain('data-ui="workspace-onboarding-directory-row"')
  expect(component).toContain("setDirectory(project.directory)")
  expect(component.indexOf('t("cwd.detected_projects")')).toBeLessThan(
    component.indexOf('t("workspace_onboarding.recent_title")'),
  )
})

test("workspace onboarding directory rows use the shared Button primitive", () => {
  expect(component).toContain('import { Button } from "./ui/Button"')
  expect(component).toContain('variant="ghost"')
  expect(component).toContain('size="md"')
  expect(component).toContain('tone="neutral"')
  expect(component).toContain('data-ui="workspace-onboarding-directory-row"')
  expect(component).not.toContain('class="workspace-onboarding-recent-item"')
  expect(source).not.toMatch(/\.workspace-onboarding-recent-item\b/)
  expect(source).toContain('.workspace-onboarding-recent-list .oc-button[data-ui="workspace-onboarding-directory-row"]')
  expect(source).not.toMatch(/workspace-onboarding-directory-row[^{}]*:focus-visible[\s\S]*outline:\s*none/)
})

test("workspace onboarding surfaces discovery failures instead of clearing to an empty discovered list", async () => {
  const state = await loadWorkspaceOnboardingDiscovery(async () => {
    throw new Error("discovery unavailable")
  })

  expect(state).toEqual({
    status: "failed",
    message: "Project discovery failed: discovery unavailable",
  })
  expect(component).toContain('data-testid="workspace-onboarding-discovery-error"')
  expect(component).not.toContain(".catch(() =>")
  expect(component).not.toContain("setDiscoveredProjects([])")
})
