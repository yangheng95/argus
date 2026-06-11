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
  expect(CONVERSATION_SERVICE).toContain("conversationHydratePath(source, tailLimit, options.directory)")
  expect(TASK_SERVICE).toContain('selectedSource?.kind === "session"')
  expect(TASK_SERVICE).toContain("`session/${encodeURIComponent(selectedSource.id)}/prompt_async`")
})

test("Mission session hydrate uses the selected row directory", () => {
  expect(MISSION_TSX).toContain("openMissionSession(mission.sessionID, mission.directory)")
  expect(CONVERSATION_SERVICE).toContain("conversationHydratePath(source, tailLimit, options.directory)")
  expect(CONVERSATION_SERVICE).toContain('params.set("directory", trimmedDirectory)')
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

test("Mission left activity selects session source and leaves chat rendering to main.tsx", () => {
  expect(MISSION_TSX).toContain('setBoardStore("selectedSource", source)')
  expect(MISSION_TSX).toContain("loadConversation(source")
  expect(MISSION_TSX).toContain("startSSE(source")
  expect(MAIN_TSX).toContain("render(() => <Conversation container={chatScroll} />, chatScroll)")
  expect(MAIN_TSX).toContain("<ChatComposer")
  expect(MISSION_TSX).not.toContain("function MissionConversation")
  expect(MISSION_TSX).not.toContain("<Conversation container=")
  expect(MISSION_TSX).not.toContain("composerDraftKey(\"mission\", \"session\"")
})

test("composer draft keys are scoped to selected task, assistant session, and Mission launcher", () => {
  expect(MAIN_TSX).toContain("const panelComposerDraftKey = () =>")
  expect(MAIN_TSX).toContain('composerDraftKey("task", taskID)')
  expect(MAIN_TSX).toContain('composerDraftKey("task", "new", directory)')
  expect(MAIN_TSX).toContain('composerDraftKey("session", sessionID)')
  expect(MAIN_TSX).toContain("draftKey={panelComposerDraftKey()}")
  expect(MISSION_TSX).toContain("const missionLauncherDraftKey = () =>")
  expect(MISSION_TSX).toContain('composerDraftKey("mission", "new", directory)')
  expect(MISSION_TSX).toContain("draftKey={missionLauncherDraftKey()}")
})

test("Mission ledger uses MissionList and not the task list projection", () => {
  expect(MISSION_TSX).toContain('import { MissionList } from "./MissionList"')
  expect(MISSION_TSX).toContain("<MissionList")
  expect(MISSION_TSX).toContain("loadMissions")
  expect(MISSION_TSX).toContain("return { search: searchQuery().trim(), refresh: missionRefreshToken() }")
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

test("Mission launcher submits through wakeMission rather than task composition", () => {
  expect(MISSION_TSX).toContain("await wakeMission({")
  expect(MISSION_TSX).toContain("text,")
  expect(MISSION_TSX).not.toContain('source: "gateway"')
  expect(MISSION_TSX).not.toContain("composeTaskText")
})

test("session empty state does not borrow the first task as Mission context", () => {
  expect(CONVERSATION_TSX).toContain('boardStore.selectedSource?.kind === "session"')
  expect(CONVERSATION_TSX).toContain("const sessionBoard")
  expect(CONVERSATION_TSX).toContain("if (isSessionSource()) return null")
  expect(CONVERSATION_TSX).toContain("sessionBoard()?.title")
  expect(CONVERSATION_TSX).toContain("sessionBoard()?.directory")
})
