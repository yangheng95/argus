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

const GATEWAY_TSX = readFileSync(join(import.meta.dir, "../src/components/Gateway.tsx"), "utf8")

function fakeTransport(
  responder: (req: TransportRequest) => Promise<TransportResponse<unknown>> | TransportResponse<unknown>,
): HostTransport {
  return {
    kind: "tauri",
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      return responder(req) as Promise<TransportResponse<T>> | TransportResponse<T>
    },
    openStream(_input: StreamOpenRequest, _handlers: StreamHandlers) {
      throw new Error("openStream not used in gateway session source tests")
    },
    async native() {
      throw new Error("native not used in gateway session source tests")
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
  const [{ loadConversation }, { submitMessage }, { __setHostTransportForTest }, { setBoardStore }] = await Promise.all([
    import("../src/services/conversation"),
    import("../src/services/task"),
    import("../src/services/host-transport"),
    import("../src/store/board"),
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
          transcript: [],
          timeline: [],
          events: [],
          view: { topLevelSessionIDs: [], sessions: [] },
          agentView: { topLevelSessionIDs: [], sessions: [] },
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
  await submitMessage("follow up")

  expect(requests).toEqual([
    { path: "session/X/conversation", method: "GET" },
    { path: "session/X/prompt_async", method: "POST" },
  ])
})

test("Gateway workbench mounts the shared Conversation and ChatComposer for mission sessions", () => {
  expect(GATEWAY_TSX).toContain("function GatewayMissionConversation")
  expect(GATEWAY_TSX).toContain("<Conversation container={conversationContainer} />")
  expect(GATEWAY_TSX).toContain("<ChatComposer")
  expect(GATEWAY_TSX).toContain('data-ui="gateway-mission-conversation"')
})
