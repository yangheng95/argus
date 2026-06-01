import { beforeEach, expect, mock, test } from "bun:test";

let calls = 0;

mock.module("../src/services/api", () => ({
  ApiError: class ApiError extends Error {},
  DEFAULT_SERVER: "http://localhost:4096",
  apiHeaders: () => ({}),
  apiUrl: (path: string) => path,
  configure: () => {},
  getServerUrl: () => "http://localhost:4096",
  onAuthChange: () => () => {},
  queryWithDirectory: () => undefined,
  apiJson: async (path: string) => {
    expect(path).toBe("goal-run/gr_inflight_cache/delivery");
    calls += 1;
    if (calls === 1) return null;
    return {
      result: {
        diffs: [
          {
            file: "src/new-file.ts",
            before: "",
            after: "export const value = 1;\n",
            additions: 1,
            deletions: 0,
            status: "added",
          },
        ],
      },
    };
  },
  apiJsonWithTimeout: async () => ({}),
  apiRequest: async () => new Response(null, { status: 204 }),
}));

const { setBoardStore } = await import("../src/store/board");
const { resolveDiff } = await import("../src/services/diff");

beforeEach(() => {
  calls = 0;
  setBoardStore("selectedSource", { kind: "task", id: "task_inflight_cache" });
  setBoardStore("board", {
    goalWorkflows: [
      {
        goalID: "goal_inflight_cache",
        goalRunID: "gr_inflight_cache",
        steps: [
          {
            payload: {
              changedFileDiffs: [
                {
                  file: "src/new-file.ts",
                  additions: 1,
                  deletions: 0,
                  status: "added",
                },
              ],
            },
          },
        ],
      },
    ],
  });
});

test("resolveDiff does not cache an in-flight empty delivery over added-file content", async () => {
  const target = { goalRunID: "gr_inflight_cache", filePath: "src/new-file.ts" };

  const first = await resolveDiff(target);
  expect(first).toMatchObject({
    file: "src/new-file.ts",
    status: "added",
    additions: 1,
    deletions: 0,
  });
  expect(first?.after).toBeUndefined();

  const second = await resolveDiff(target);
  expect(second).toMatchObject({
    file: "src/new-file.ts",
    before: "",
    after: "export const value = 1;\n",
    status: "added",
  });
  expect(calls).toBe(2);
});
