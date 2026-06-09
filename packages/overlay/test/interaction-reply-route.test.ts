import { afterEach, expect, test } from "bun:test"
import type {
  HostTransport,
  StreamHandlers,
  StreamOpenRequest,
  TransportRequest,
  TransportResponse,
} from "../src/services/host-transport"
import { __setHostTransportForTest } from "../src/services/host-transport"
import { rejectInteraction, replyInteraction } from "../src/services/interaction-reply"

function recordingTransport(requests: TransportRequest[]): HostTransport {
  return {
    kind: "tauri",
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      requests.push(req)
      return { status: 200, ok: true, headers: {}, body: true as T }
    },
    openStream(_input: StreamOpenRequest, _handlers: StreamHandlers) {
      throw new Error("openStream not used in interaction reply route tests")
    },
    async native() {
      throw new Error("native not used in interaction reply route tests")
    },
    subscribeUiCommand() {
      return { unsubscribe() {} }
    },
  }
}

afterEach(() => {
  __setHostTransportForTest(undefined)
})

test("raw question replies use the question route", async () => {
  const requests: TransportRequest[] = []
  __setHostTransportForTest(recordingTransport(requests))

  await replyInteraction(
    "que_route_answer",
    "answer",
    false,
    {
      answers: [["Vite + React"]],
    },
    "question",
  )
  await rejectInteraction("que_route_reject", false, "question")

  expect(requests.map((req) => [req.method, req.path])).toEqual([
    ["POST", "question/que_route_answer/reply"],
    ["POST", "question/que_route_reject/reject"],
  ])
  expect(requests[0]?.body).toEqual({
    kind: "json",
    value: { answers: [["Vite + React"]] },
  })
  expect(requests[1]?.body).toBeUndefined()
})

test("engine interactions keep using the interaction route", async () => {
  const requests: TransportRequest[] = []
  __setHostTransportForTest(recordingTransport(requests))

  await replyInteraction("interaction_route_answer", "answer", false, {
    answers: [["Mock data"]],
  })

  expect(requests.map((req) => [req.method, req.path])).toEqual([
    ["POST", "interaction/interaction_route_answer/reply"],
  ])
})
