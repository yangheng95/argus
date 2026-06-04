import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const HTML = readFileSync(join(import.meta.dir, "../src/index.html"), "utf8")
const MAIN = readFileSync(join(import.meta.dir, "../src/main.tsx"), "utf8")

test("Sidebar exposes a Mission entry button (template §6.2)", () => {
  expect(HTML).toContain('id="btnMission"')
  expect(HTML).toContain('data-ui="sidebar-mission-button"')
  expect(HTML).toContain('data-i18n="mission.open"')
})

test("Index links the mission surface CSS so the new page styles ship", () => {
  expect(HTML).toContain('href="styles/surfaces/mission.css"')
})

test("Index ships a dedicated Mission mount node outside the conversation panel", () => {
  expect(HTML).toContain('id="solidMissionMount"')
})

test("main.tsx wires the Mission button and mounts the Mission component", () => {
  expect(MAIN).toContain('document.getElementById("btnMission")?.addEventListener("click"')
  expect(MAIN).toContain('setPageMode(pageMode() === "mission" ? "panel" : "mission")')
  expect(MAIN).toContain('document.getElementById("solidMissionMount")')
  expect(MAIN).toContain("render(() => <Mission />, missionMountEl)")
})

test("Mission page exposes an in-page Back to Panel action", () => {
  const mission = readFileSync(join(import.meta.dir, "../src/components/Mission.tsx"), "utf8")
  const missionList = readFileSync(join(import.meta.dir, "../src/components/MissionList.tsx"), "utf8")
  expect(missionList).toContain('data-ui="mission-back-panel"')
  expect(missionList).toContain('data-ui="mission-new-requirement"')
  expect(missionList).not.toContain('data-ui="mission-refresh"')
  expect(mission).toContain('onBackToPanel={() => setPageMode("panel")}')
})

test("main.tsx reflects pageMode onto body[data-page-mode] (drives mission.css visibility)", () => {
  expect(MAIN).toContain("document.body.dataset.pageMode = pageMode()")
})

test("New chat button switches back to panel mode before focusing the composer (template §6.3)", () => {
  // Operator clicking +New Chat from inside Mission should not get stuck on
  // an invisible composer — the page must flip back to panel first.
  expect(MAIN).toMatch(/btnCreateTask[\s\S]*setPageMode\("panel"\)[\s\S]*selectTask\(""\)/)
})
