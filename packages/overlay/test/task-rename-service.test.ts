// Contract test for renameTask:
// - sends PATCH task/<id>/title with the trimmed title body
// - rejects empty / overlong titles without making a network call
// - reports failure on non-2xx so the row can revert its optimistic edit
//
// We stub the HostTransport so the assertions are entirely synchronous and
// don't need a backend. The renameTask flow refreshes the board after the
// PATCH; the loadTasks call is allowed to no-op against the same transport.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { __setHostTransportForTest } from "../src/services/host-transport";
import type {
  HostTransport,
  TransportRequest,
  TransportResponse,
} from "../src/services/host-transport";

interface Captured {
  path: string;
  method: string;
  body: unknown;
}

type Responder = (req: TransportRequest) => TransportResponse<unknown>;

function fakeTransport(responder: Responder): HostTransport {
  return {
    kind: "tauri",
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      return responder(req) as TransportResponse<T>;
    },
    openStream() {
      throw new Error("openStream not used");
    },
    async native() {
      throw new Error("native not used");
    },
    subscribeUiCommand() {
      return { unsubscribe() {} };
    },
  } as unknown as HostTransport;
}

const { renameTask } = await import("../src/services/task");

let captured: Captured[];

beforeEach(() => {
  captured = [];
});

afterEach(() => __setHostTransportForTest(undefined));

function recordingTransport(patchStatus = 200): HostTransport {
  return fakeTransport((req) => {
    captured.push({
      path: req.path,
      method: req.method,
      body: req.body && (req.body as any).kind === "json" ? (req.body as any).value : req.body,
    });
    // PATCH renames return 200/true; GET tasks (loadTasks refresh) returns
    // an empty list so the refresh call is a no-op.
    if (req.method === "PATCH") {
      return { status: patchStatus, ok: patchStatus < 400, headers: {}, body: true };
    }
    return { status: 200, ok: true, headers: {}, body: { tasks: [] } };
  });
}

describe("renameTask service contract", () => {
  test("PATCHes task/<id>/title with the trimmed title", async () => {
    __setHostTransportForTest(recordingTransport());
    const ok = await renameTask("tsk_abc123", "  New name  ");
    expect(ok).toBe(true);
    const patches = captured.filter((c) => c.method === "PATCH");
    expect(patches.length).toBe(1);
    expect(patches[0]!.path).toBe("task/tsk_abc123/title");
    expect(patches[0]!.body).toEqual({ title: "New name" });
  });

  test("empty title is rejected client-side without a network call", async () => {
    __setHostTransportForTest(recordingTransport());
    const ok = await renameTask("tsk_abc123", "   ");
    expect(ok).toBe(false);
    expect(captured.filter((c) => c.method === "PATCH").length).toBe(0);
  });

  test("oversize title (>200 chars) is rejected client-side", async () => {
    __setHostTransportForTest(recordingTransport());
    const ok = await renameTask("tsk_abc123", "x".repeat(201));
    expect(ok).toBe(false);
    expect(captured.filter((c) => c.method === "PATCH").length).toBe(0);
  });

  test("missing taskID short-circuits", async () => {
    __setHostTransportForTest(recordingTransport());
    const ok = await renameTask("", "Something");
    expect(ok).toBe(false);
    expect(captured.length).toBe(0);
  });

  test("server error surfaces as false (caller can revert UI)", async () => {
    __setHostTransportForTest(recordingTransport(500));
    const ok = await renameTask("tsk_abc123", "New name");
    expect(ok).toBe(false);
  });
});
