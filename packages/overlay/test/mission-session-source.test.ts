import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test"
;(globalThis as typeof globalThis & { window?: unknown }).window = globalThis
;(globalThis as typeof globalThis & { location?: unknown }).location = {
  protocol: "http:",
  host: "localhost",
  origin: "http://localhost",
  pathname: "/",
}

const CONVERSATION_TSX = readFileSync(join(import.meta.dir, "../src/components/Conversation.tsx"), "utf8")
const CONVERSATION_SERVICE = readFileSync(join(import.meta.dir, "../src/services/conversation.ts"), "utf8")
const TASK_SERVICE = readFileSync(join(import.meta.dir, "../src/services/task.ts"), "utf8")
const MAIN_TSX = readFileSync(join(import.meta.dir, "../src/main.tsx"), "utf8")
const CHAT_SERVICE = readFileSync(join(import.meta.dir, "../src/services/chat.ts"), "utf8")
const WORK_LEDGER_TSX = readFileSync(join(import.meta.dir, "../src/components/WorkLedger.tsx"), "utf8")

test("session source hydrates from session conversation and submits to prompt_async", () => {
  expect(CONVERSATION_SERVICE).toContain('const prefix = source.kind === "task" ? "task" : "session"')
  expect(CONVERSATION_SERVICE).toContain(
    "const requestDirectory = conversationRequestDirectory(source, options.directory)",
  )
  expect(CONVERSATION_SERVICE).toContain("conversationHydratePath(source, tailLimit, requestDirectory)")
  expect(TASK_SERVICE).toContain('selectedSource?.kind === "session"')
  expect(TASK_SERVICE).toContain("`session/${encodeURIComponent(selectedSource.id)}/prompt_async`")
})

test("Mission session hydrate uses the selected Work Ledger row directory", () => {
  expect(MAIN_TSX).toContain("async function openWorkLedgerMission(row: WorkLedgerMissionRow)")
  expect(MAIN_TSX).toContain("row.directory")
  expect(CONVERSATION_SERVICE).toContain(
    'if (source.kind === "session") return requireDirectory(trimmed, "hydrateConversation")',
  )
  expect(CONVERSATION_SERVICE).toContain("conversationHydratePath(source, tailLimit, requestDirectory)")
  expect(CONVERSATION_SERVICE).toContain('if (trimmed) params.set("directory", trimmed)')
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

test("Work Ledger selects Mission and Chat sessions while main.tsx renders the shared conversation", () => {
  expect(WORK_LEDGER_TSX).toContain("onSelectMission")
  expect(WORK_LEDGER_TSX).toContain("onSelectChat")
  expect(MAIN_TSX).toContain("async function openWorkLedgerMission")
  expect(MAIN_TSX).toContain("async function openWorkLedgerChat")
  expect(MAIN_TSX).toContain('setBoardStore("selectedSource", source)')
  expect(MAIN_TSX).toContain("loadConversation(source")
  expect(MAIN_TSX).toContain("startSSE(source")
  expect(MAIN_TSX).toContain("render(() => <Conversation container={chatScroll} />, chatScroll)")
  expect(MAIN_TSX).toContain("<ChatComposer")
  expect(MAIN_TSX).not.toContain("<Mission")
  expect(MAIN_TSX).not.toContain("<CodingAssistantSessionList")
})

test("composer draft keys are scoped to selected task, selected session, and new Mission/Chat modes", () => {
  expect(MAIN_TSX).toContain("const panelComposerDraftKey = () =>")
  expect(MAIN_TSX).toContain('composerDraftKey("mission", "new", directory)')
  expect(MAIN_TSX).toContain('composerDraftKey("assistant", "new", directory)')
  expect(MAIN_TSX).toContain('composerDraftKey("task", taskID)')
  expect(MAIN_TSX).toContain('composerDraftKey("session", sessionID)')
  expect(MAIN_TSX).toContain("draftKey={panelComposerDraftKey()}")
})

test("new Mission and Chat submissions reuse the main ChatComposer with separate mode bindings", () => {
  expect(MAIN_TSX).toContain("<ChatComposer")
  expect(MAIN_TSX).toContain("composerMode={composerMode()}")
  expect(MAIN_TSX).toContain("onComposerModeChange={handleComposerModeChange}")
  expect(MAIN_TSX).toContain("function missionSubmitActive(): boolean")
  expect(MAIN_TSX).toContain("function assistantSubmitActive(): boolean")
  expect(MAIN_TSX).toContain("const result = await wakeMission({ text, model, promptProfile })")
  expect(MAIN_TSX).toContain("await openMissionSession(result)")
  expect(MAIN_TSX).toContain("await createCodingAssistantSession({ directory: activeDirectory() })")
  expect(MAIN_TSX).toContain("await panelMessage(text, attachments, metadata)")
  expect(CHAT_SERVICE).toContain("const sessionID = activeSessionID()")
  expect(CHAT_SERVICE).toContain("`session/${encodeURIComponent(sessionID)}/prompt_async`")
})

test("session empty state does not borrow the first task as Mission context", () => {
  expect(CONVERSATION_TSX).toContain('boardStore.selectedSource?.kind === "session"')
  expect(CONVERSATION_TSX).toContain("const sessionBoard")
  expect(CONVERSATION_TSX).toContain("if (isSessionSource()) return null")
  expect(CONVERSATION_TSX).toContain("sessionBoard()?.title")
  expect(CONVERSATION_TSX).toContain("sessionBoard()?.directory")
})
