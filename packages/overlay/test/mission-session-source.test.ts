import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test"
;(globalThis as any).window = globalThis
;(globalThis as any).location = { protocol: "http:", host: "localhost", origin: "http://localhost", pathname: "/" }

const MISSION_TSX = readFileSync(join(import.meta.dir, "../src/components/Mission.tsx"), "utf8")
const MISSION_LIST_TSX = readFileSync(join(import.meta.dir, "../src/components/MissionList.tsx"), "utf8")
const CONVERSATION_TSX = readFileSync(join(import.meta.dir, "../src/components/Conversation.tsx"), "utf8")
const CONVERSATION_SERVICE = readFileSync(join(import.meta.dir, "../src/services/conversation.ts"), "utf8")
const TASK_SERVICE = readFileSync(join(import.meta.dir, "../src/services/task.ts"), "utf8")
const MAIN_TSX = readFileSync(join(import.meta.dir, "../src/main.tsx"), "utf8")

test("session source hydrates from session conversation and submits to prompt_async", () => {
  expect(CONVERSATION_SERVICE).toContain('const prefix = source.kind === "task" ? "task" : "session"')
  expect(CONVERSATION_SERVICE).toContain("conversationHydratePath(source, tailLimit)")
  expect(TASK_SERVICE).toContain('selectedSource?.kind === "session"')
  expect(TASK_SERVICE).toContain("`session/${encodeURIComponent(selectedSource.id)}/prompt_async`")
})

test("session source cannot page older task conversation history", () => {
  expect(CONVERSATION_SERVICE).toContain("let historySource: BoardSource | null = null")
  expect(CONVERSATION_SERVICE).toContain("sourceMatches(source, historySource)")
  expect(CONVERSATION_SERVICE).toContain('source.kind === "task"')
  expect(CONVERSATION_SERVICE).toContain('if (!source || source.kind !== "task") return false')
  expect(CONVERSATION_SERVICE).toContain('targetSessionID && selectedSource?.kind !== "session"')
  expect(CONVERSATION_SERVICE).toContain('targetSessionID && selectedSource?.kind === "session"')
  expect(CONVERSATION_TSX).toContain("const source = boardStore.selectedSource")
  expect(CONVERSATION_TSX).toContain("canLoadOlderConversationHistory(source)")
  expect(CONVERSATION_TSX).toContain("loadOlderConversationHistory(source)")
})

test("Mission workbench mounts the shared Conversation and ChatComposer for mission sessions", () => {
  expect(MISSION_TSX).toContain("function MissionConversation")
  expect(MISSION_TSX).toContain("<Conversation container={conversationContainer} />")
  expect(MISSION_TSX).toContain("<ChatComposer")
  expect(MISSION_TSX).toContain('composerDraftKey("mission", "session", props.sessionID)')
  expect(MISSION_TSX).toContain('data-ui="mission-conversation"')
})

test("composer draft keys are scoped to selected task and Mission launcher/session", () => {
  expect(MAIN_TSX).toContain("const panelComposerDraftKey = () =>")
  expect(MAIN_TSX).toContain('composerDraftKey("task", taskID)')
  expect(MAIN_TSX).toContain('composerDraftKey("task", "new", directory)')
  expect(MAIN_TSX).toContain("draftKey={panelComposerDraftKey()}")
  expect(MISSION_TSX).toContain("const missionLauncherDraftKey = () =>")
  expect(MISSION_TSX).toContain('composerDraftKey("mission", "new", directory)')
  expect(MISSION_TSX).toContain("draftKey={props.missionLauncherDraftKey}")
})

test("Mission ledger uses MissionList and not the task list projection", () => {
  expect(MISSION_TSX).toContain('import { MissionList } from "./MissionList"')
  expect(MISSION_TSX).toContain("<MissionList")
  expect(MISSION_TSX).toContain("loadMissions")
  expect(MISSION_TSX).toContain("return { search: searchQuery().trim(), refresh: missionRefreshToken() }")
  expect(MISSION_TSX).not.toContain("directory: input.directory")
  expect(MISSION_TSX).not.toContain('import { TaskList } from "./TaskList"')
  expect(MISSION_TSX).not.toContain("<TaskList")
  expect(MISSION_TSX).not.toContain("visibleTasks")
  expect(MISSION_TSX).not.toContain("function MissionTaskConversation")
  expect(MISSION_TSX).not.toContain('data-ui="mission-task-conversation"')
})

test("Mission ledger groups records by project directory", () => {
  expect(MISSION_LIST_TSX).toContain("const groupedMissions = createMemo")
  expect(MISSION_LIST_TSX).toContain("mission.directory")
  expect(MISSION_LIST_TSX).toContain('class="project-group mission-project-group"')
  expect(MISSION_LIST_TSX).toContain('data-ui="mission-project-group"')
  expect(MISSION_LIST_TSX).toContain("<For each={group.items}>")
})

test("Mission page submits messages tagged with the mission source label", () => {
  // The message source label sent from the page is now "mission" (was
  // "gateway") — the squad/team task provenance keys off source==="mission"
  // (specs/gateway-mission-split-2026-05-28.md §4).
  expect(MISSION_TSX).toContain('source: "mission"')
})

test("session empty state does not borrow the first task as Mission context", () => {
  expect(CONVERSATION_TSX).toContain('boardStore.selectedSource?.kind === "session"')
  expect(CONVERSATION_TSX).toContain("const sessionBoard")
  expect(CONVERSATION_TSX).toContain("if (isSessionSource()) return null")
  expect(CONVERSATION_TSX).toContain("sessionBoard()?.title")
  expect(CONVERSATION_TSX).toContain("sessionBoard()?.directory")
})
