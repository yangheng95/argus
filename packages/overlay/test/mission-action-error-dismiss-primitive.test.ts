import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const MISSION_TSX = readFileSync(join(import.meta.dir, "../src/components/Mission.tsx"), "utf8")
const MISSION_CSS = readFileSync(join(import.meta.dir, "../src/styles/surfaces/mission.css"), "utf8")

test("Mission global action error dismiss uses the shared Button primitive", () => {
  expect(MISSION_TSX).toContain('import { Button } from "./ui/Button"')
  expect(MISSION_TSX).toContain('data-ui="mission-action-error-dismiss"')
  expect(MISSION_TSX).toContain('data-chrome="icon-action"')
  expect(MISSION_TSX).toContain('variant="ghost"')
  expect(MISSION_TSX).toContain('size="icon"')
  expect(MISSION_TSX).toContain('tone="neutral"')
  expect(MISSION_TSX).toContain('aria-label={t("common.clear")}')
  expect(MISSION_TSX).toContain('title={t("common.clear")}')
  expect(MISSION_TSX).not.toMatch(/<button[\s\S]*mission-action-error-dismiss/)
  expect(MISSION_TSX).not.toContain('class="mission-action-error-dismiss"')
})

test("Mission global action error dismiss has no private button shell CSS", () => {
  expect(MISSION_CSS).not.toMatch(/\.mission-action-error-dismiss\b/)
  expect(MISSION_CSS).toContain('.mission-action-error .oc-button[data-ui="mission-action-error-dismiss"]')
  expect(MISSION_CSS).toContain('.mission-action-error .oc-button[data-ui="mission-action-error-dismiss"] > svg')
  expect(MISSION_CSS).not.toContain("outline: none")
})
