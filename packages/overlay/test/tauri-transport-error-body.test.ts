import { afterEach, describe, expect, test } from "bun:test";
import { createTauriTransport } from "../src/services/tauri-transport";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("tauri transport error body", () => {
  test("preserves JSON response bodies on non-2xx API responses", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          name: "DirectoryRequiredError",
          data: {
            message: "Project-scoped route /tasks requires ?directory=",
          },
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );

    const res = await createTauriTransport().request({ path: "tasks" });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      name: "DirectoryRequiredError",
      data: {
        message: "Project-scoped route /tasks requires ?directory=",
      },
    });
  });
});
