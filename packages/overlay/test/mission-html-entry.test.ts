import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const HTML = readFileSync(join(import.meta.dir, "../src/index.html"), "utf8")
const MAIN = readFileSync(join(import.meta.dir, "../src/main.tsx"), "utf8")
const MISSION = readFileSync(join(import.meta.dir, "../src/components/Mission.tsx"), "utf8")
const MISSION_LIST = readFileSync(join(import.meta.dir, "../src/components/MissionList.tsx"), "utf8")

test("index.html exposes Mission as a left activity body and removes the standalone Mission page", () => {
  expect(HTML).toContain('id="solidLeftActivityToolbar"')
  expect(HTML).toContain('id="leftPanelMissions"')
  expect(HTML).toContain('data-side-activity="mission"')
  expect(HTML).toContain('id="missionListPanel"')
  expect(HTML).toContain('href="styles/surfaces/mission.css"')
  expect(HTML).not.toContain('id="btnMission"')
  expect(HTML).not.toContain('data-ui="sidebar-mission-button"')
  expect(HTML).not.toContain('id="solidMissionMount"')
})

test("project directory bar remains page-level chrome above the panel", () => {
  const projectBarIndex = HTML.indexOf('id="solidProjectDirectoryBarMount"')
  const mainIndex = HTML.indexOf('<main class="panel">')
  expect(projectBarIndex).toBeGreaterThan(0)
  expect(projectBarIndex).toBeLessThan(mainIndex)
})

test("main.tsx mounts Mission through the left activity system", () => {
  expect(MAIN).toContain('type LeftActivity = "tasks" | "mission" | "assistant" | "memory" | "skill" | "mcp"')
  expect(MAIN).toContain(
    'id: "mission", icon: "mission", labelKey: "mission.title", tooltipKey: "activity.tooltip.mission"',
  )
  expect(MAIN).toContain('mission: "leftPanelMissions"')
  expect(MAIN).toContain('mission: "mission.title"')
  expect(MAIN).toContain('document.getElementById("missionListPanel")')
  expect(MAIN).toContain('<Mission active={selectedLeftPanelActivity() === "mission"}')
  expect(MAIN).toContain("onSelectTask={(taskID) => void selectTask(taskID)}")
  expect(MAIN).not.toContain('document.getElementById("btnMission")')
  expect(MAIN).not.toContain('document.getElementById("solidMissionMount")')
  expect(MAIN).not.toContain("setPageMode")
  expect(MAIN).not.toContain("pageMode()")
  expect(MAIN).not.toContain("document.body.dataset.pageMode")
})

test("Mission activity opens session conversations through the shared center chat", () => {
  expect(MISSION).toContain('setBoardStore("selectedSource", source)')
  expect(MISSION).toContain('setBoardStore("board", null)')
  expect(MISSION).toContain("loadConversation(source")
  expect(MISSION).toContain("startSSE(source")
  expect(MISSION).not.toContain("function MissionConversation")
  expect(MISSION).not.toContain("<Conversation")
  expect(MISSION).not.toContain("<ConversationAgentRail")
  expect(MISSION).not.toContain("<WorkspacePanel")
})

test("Mission-created task rows select the task panel instead of rendering task chat inside Mission", () => {
  expect(MISSION_LIST).toContain('data-ui="mission-task-projection-select"')
  expect(MISSION_LIST).toContain("props.onSelectTask(props.task.id)")
  expect(MISSION_LIST).not.toContain('data-ui="mission-back-panel"')
  expect(MISSION_LIST).not.toContain("onBackToPanel")
})

test("Mission no longer loads or renders the retired Channel panel", () => {
  expect(MISSION).not.toContain("loadChannelList")
  expect(MISSION).not.toContain("loadChannelRuntime")
  expect(MISSION).not.toContain("restartChannelRuntime")
  expect(MISSION).not.toContain("MissionChannelPanel")
  expect(MISSION).not.toContain('data-ui="mission-channels"')
})
