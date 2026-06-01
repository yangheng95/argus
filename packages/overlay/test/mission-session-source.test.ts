import { afterEach, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type {
  HostTransport,
  StreamHandlers,
  StreamOpenRequest,
  TransportRequest,
  TransportResponse,
} from "../src/services/host-transport"

;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ =
  "test"
;(globalThis as any).window = globalThis
;(globalThis as any).location = { protocol: "http:", host: "localhost", origin: "http://localhost", pathname: "/" }

const MISSION_TSX = readFileSync(join(import.meta.dir, "../src/components/Mission.tsx"), "utf8")
const MISSION_LIST_TSX = readFileSync(join(import.meta.dir, "../src/components/MissionList.tsx"), "utf8")
const CONVERSATION_TSX = readFileSync(join(import.meta.dir, "../src/components/Conversation.tsx"), "utf8")

function fakeTransport(
  responder: (req: TransportRequest) => Promise<TransportResponse<unknown>> | TransportResponse<unknown>,
): HostTransport {
  return {
    kind: "tauri",
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      return responder(req) as Promise<TransportResponse<T>> | TransportResponse<T>
    },
    openStream(_input: StreamOpenRequest, _handlers: StreamHandlers) {
      throw new Error("openStream not used in mission session source tests")
    },
    async native() {
      throw new Error("native not used in mission session source tests")
    },
    subscribeUiCommand() {
      return { unsubscribe() {} }
    },
  } satisfies HostTransport
}

afterEach(async () => {
  const [{ cancelConversationReplay }, { resetWriter }, { __setHostTransportForTest }, { setBoardStore }] = await Promise.all([
    import("../src/services/conversation"),
    import("../src/services/tree-writer"),
    import("../src/services/host-transport"),
    import("../src/store/board"),
  ])
  cancelConversationReplay()
  resetWriter()
  __setHostTransportForTest(undefined)
  setBoardStore("selectedSource", null)
  setBoardStore("board", null)
})

test("session source hydrates conversation and submits to prompt_async", async () => {
  const [
    { loadConversation },
    { submitMessage },
    { __setHostTransportForTest },
    { setBoardStore },
    { cardTreeStore },
  ] = await Promise.all([
    import("../src/services/conversation"),
    import("../src/services/task"),
    import("../src/services/host-transport"),
    import("../src/store/board"),
    import("../src/store/card-tree"),
  ])
  const requests: Array<{ path: string; method?: string }> = []
  __setHostTransportForTest(fakeTransport((req) => {
    requests.push({ path: req.path, method: req.method })
    if (req.path === "session/X/conversation") {
      return {
        status: 200,
        ok: true,
        headers: {},
        body: {
          board: { kind: "session", sessionID: "X", status: "active", title: "Mission", directory: "D:/repo" },
          transcript: [
            {
              info: {
                id: "msg_mission_history",
                sessionID: "X",
                role: "assistant",
                agent: "mission",
                resolvedRole: "mission",
                channel: "mission",
                time: { created: 1_780_000_000_000 },
              },
              parts: [
                {
                  id: "part_mission_history",
                  messageID: "msg_mission_history",
                  sessionID: "X",
                  type: "text",
                  text: "Mission remembered benchmark request.",
                },
              ],
            },
          ],
          timeline: [],
          events: [],
          view: { topLevelSessionIDs: ["X"], sessions: [{ sessionID: "X", kind: "mission" }] },
          agentView: { topLevelSessionIDs: ["X"], sessions: [{ sessionID: "X", kind: "mission" }] },
          history: { oldestTimestamp: null, oldestMessageID: null, hasMore: false, limit: 0 },
        },
      }
    }
    if (req.path === "session/X/prompt_async") {
      return { status: 202, ok: true, headers: {}, body: { taskID: "queue_1" } }
    }
    throw new Error(`unexpected request ${req.path}`)
  }))

  setBoardStore("selectedSource", { kind: "session", id: "X" })

  await loadConversation({ kind: "session", id: "X" })
  expect(Object.values(cardTreeStore.cards).some((card) =>
    card.parts.some((part: any) => part.text === "Mission remembered benchmark request."),
  )).toBe(true)
  await submitMessage("follow up")

  expect(requests).toEqual([
    { path: "session/X/conversation", method: "GET" },
    { path: "session/X/prompt_async", method: "POST" },
  ])
})

test("Mission workbench mounts the shared Conversation and ChatComposer for mission sessions", () => {
  expect(MISSION_TSX).toContain("function MissionConversation")
  expect(MISSION_TSX).toContain("<Conversation container={conversationContainer} />")
  expect(MISSION_TSX).toContain("<ChatComposer")
  expect(MISSION_TSX).toContain('data-ui="mission-conversation"')
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
