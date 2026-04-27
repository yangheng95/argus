import { afterEach, describe, expect, mock, test } from "bun:test";

import { configure } from "../src/services/api";
import { cancelAgentSession, replyToAgentSession } from "../src/services/task";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  configure({ serverUrl: "http://127.0.0.1:41111", directory: "" });
});

describe("agent session controls", () => {
  test("replyToAgentSession posts scoped human input to the child session route", async () => {
    configure({ serverUrl: "http://overlay.test", directory: "" });
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), {
        status: 202,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await replyToAgentSession("tsk_1", "ses_child/1", "  keep this local  ");

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("http://overlay.test/task/tsk_1/session/ses_child%2F1/reply");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ message: "keep this local" });
  });

  test("cancelAgentSession posts to the child session cancel route", async () => {
    configure({ serverUrl: "http://overlay.test", directory: "" });
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await cancelAgentSession("tsk_1", "ses_child");

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("http://overlay.test/task/tsk_1/session/ses_child/cancel");
    expect(calls[0].init?.method).toBe("POST");
  });
});
