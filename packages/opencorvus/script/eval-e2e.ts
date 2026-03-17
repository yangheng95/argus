/**
 * E2E Evaluation Framework for OpenCorvus Agent Pipeline
 *
 * Submits real tasks through the orchestrator API, polls for completion,
 * and scores deliveries using the evaluation system's own metrics.
 *
 * Features:
 *   - Real-time session message display (simulates overlay session area)
 *   - SSE event streaming for live task updates
 *   - Auto-start compiled binary with --start-server
 *
 * Usage:
 *   OPENCORVUS_SERVER=http://127.0.0.1:7878 bun run script/eval-e2e.ts
 *   OPENCORVUS_SERVER=http://127.0.0.1:7878 bun run script/eval-e2e.ts --case=E1
 *   bun run script/eval-e2e.ts --start-server --case=E2
 *   bun run script/eval-e2e.ts --dry-run
 */

import fs from "fs"
import path from "path"
import { DEFAULT_OPENAI_CODEX_MODEL, normalizeOpenAICodexModel } from "../src/provider/codex-live"

/** Normalize Windows backslashes to forward slashes for shell commands */
function toUnixPath(p: string): string {
  return p.replace(/\\/g, "/")
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SERVER = process.env.OPENCORVUS_SERVER ?? "http://127.0.0.1:7878"
const POLL_INTERVAL_MS = 3_000
const SESSION_POLL_MS = 2_000
const MAX_WAIT_MS = 10 * 60 * 1000 // 10 minutes per case
const DRY_RUN = process.argv.includes("--dry-run")
const START_SERVER = process.argv.includes("--start-server")
const CASE_FILTER = process.argv.find((a) => a.startsWith("--case="))?.split("=")[1]
const VERBOSE = process.argv.includes("--verbose") || process.argv.includes("-v")
const MODEL = normalizeOpenAICodexModel(process.env.OPENCORVUS_E2E_MODEL ?? DEFAULT_OPENAI_CODEX_MODEL)

// ---------------------------------------------------------------------------
// Types (aligned with orchestrator/model.ts Progress schema)
// ---------------------------------------------------------------------------

interface EvalCase {
  id: string
  name: string
  difficulty: "easy" | "medium" | "hard"
  /** Files to scaffold before submitting the task */
  scaffold: Record<string, string>
  /** Task creation payload */
  task: {
    title: string
    request: string
    checks?: Record<string, unknown>
    goals?: Array<{
      description: string
      criteria: string
      priority?: "blocking" | "advisory"
    }>
    budget?: {
      maxRuns?: number
      maxReplans?: number
    }
  }
  /** Expected outcomes for grading */
  expected: {
    completion: boolean
    minGoalPassRate: number // 0-1
    minCheckPassRate: number // 0-1
  }
}

interface TaskProgress {
  task: {
    id: string
    projectID: string
    sessionID?: string | null
    activeRunID?: string | null
    activePlanVersionID?: string | null
    requestID?: string
    source: string
    status: string
    title: string
    request: string
    priority: string
    blockingReason?: string
    error?: string
    budget?: Record<string, unknown>
    time: { created: number; updated: number; started?: number; completed?: number }
  }
  plan?: {
    id: string
    summary: string
    prompt: string
    goals?: Array<{ description: string; criteria: string; priority?: string }>
    metadata?: Record<string, unknown>
  }
  goals: Array<{
    id: string
    description: string
    criteria: string
    priority: string
    status: string
    metadata?: Record<string, unknown>
  }>
  milestones?: Array<{
    id: string
    title: string
    status: string
  }>
  run?: {
    id: string
    taskID: string
    sessionID?: string | null
    status: string
    phase?: string
    executor?: string
    attempt?: number
    retryCount?: number
    time: { created: number; updated: number; started?: number; completed?: number }
  }
  pendingInteractions: Array<{
    id: string
    status: string
    type: string
    title?: string
  }>
  delivery?: {
    id: string
    status: string
    summary: string
    result?: {
      changed_files?: string[]
      diffs?: Array<{ file: string; diff?: string }>
    }
  }
  evaluation?: {
    id: string
    status: string
    verdict: string
    summary: string
    checks: Array<{
      name: string
      status: string
      evidence?: string
    }>
  }
  snapshots: Array<{
    id: string
    status: string
    summary: string
  }>
}

/** Session message (from GET /session/:id/message) */
interface SessionMessage {
  info: {
    id: string
    role: string
    time?: { created: number; updated: number }
    parentID?: string
  }
  parts: Array<{
    id: string
    type: string
    text?: string
    toolName?: string
    input?: unknown
    output?: unknown
  }>
}

interface EvalResult {
  caseID: string
  caseName: string
  difficulty: string
  taskID: string
  status: "completed" | "failed" | "cancelled" | "timeout"
  wallTimeMs: number
  totalRuns: number
  sessionMessageCount: number
  scores: {
    completion: number
    checkPassRate: number
    goalPassRate: number
    efficiency: number
    wallTimeScore: number
  }
  overall: number
  details: {
    planSummary?: string
    evalVerdict?: string
    evalSummary?: string
    checks?: Array<{ name: string; status: string }>
    goals?: Array<{ description: string; status: string }>
    changedFiles?: string[]
    error?: string
    sessionFlow?: string[]
  }
}

// ---------------------------------------------------------------------------
// ANSI color helpers
// ---------------------------------------------------------------------------

const color = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
}

function c(text: string, ...styles: string[]) {
  return styles.join("") + text + color.reset
}

// ---------------------------------------------------------------------------
// Test Cases
// ---------------------------------------------------------------------------

/** Create workspace inside the project worktree so the agent can access it */
async function evalWorkspaceDir(): Promise<string> {
  try {
    const tasks = await apiCall<{ project: { worktree: string } }>("GET", "/tasks")
    const worktree = tasks.project.worktree
    return path.join(worktree, "eval-workspace-" + Date.now())
  } catch {
    return path.join(process.cwd(), "eval-workspace-" + Date.now())
  }
}

const CASES: EvalCase[] = [
  // ======== E1: Create a utility module (Easy) ========
  {
    id: "E1",
    name: "Create math utility module",
    difficulty: "easy",
    scaffold: {
      "package.json": JSON.stringify(
        {
          name: "eval-case-e1",
          version: "1.0.0",
          scripts: {
            build: "tsc --noEmit",
            test: "bun test",
          },
          devDependencies: {
            typescript: "^5.4.0",
            "@types/bun": "latest",
          },
        },
        null,
        2,
      ),
      "tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "bundler",
            strict: true,
            outDir: "dist",
            rootDir: "src",
            skipLibCheck: true,
          },
          include: ["src"],
        },
        null,
        2,
      ),
      "src/index.ts": `// Entry point\nexport {};\n`,
    },
    task: {
      title: "Add math utility functions",
      request:
        "在 src/math.ts 中创建一个数学工具模块，导出以下函数：\n" +
        "1. add(a, b) - 加法\n" +
        "2. subtract(a, b) - 减法\n" +
        "3. multiply(a, b) - 乘法\n" +
        "4. divide(a, b) - 除法（除以0时抛出错误）\n" +
        "5. clamp(value, min, max) - 将值限制在范围内\n\n" +
        "同时在 src/math.test.ts 中编写测试，覆盖正常情况和边界情况（如除以0）。\n" +
        "在 src/index.ts 中 re-export 所有函数。",
      checks: {
        build: ["bunx tsc --noEmit"],
        test: ["bun test"],
      },
      goals: [
        {
          description: "Math functions implemented",
          criteria: "src/math.ts exports add, subtract, multiply, divide, clamp with correct types",
          priority: "blocking",
        },
        {
          description: "Tests comprehensive",
          criteria: "src/math.test.ts covers all 5 functions including edge cases (divide by 0, clamp boundaries)",
          priority: "blocking",
        },
        {
          description: "Re-exported from index",
          criteria: "src/index.ts re-exports all math functions",
          priority: "advisory",
        },
      ],
      budget: { maxRuns: 3, maxReplans: 1 },
    },
    expected: {
      completion: true,
      minGoalPassRate: 0.8,
      minCheckPassRate: 1.0,
    },
  },

  // ======== E2: Fix a known bug (Medium) ========
  {
    id: "E2",
    name: "Fix numeric sort bug",
    difficulty: "medium",
    scaffold: {
      "package.json": JSON.stringify(
        {
          name: "eval-case-e2",
          version: "1.0.0",
          scripts: {
            build: "tsc --noEmit",
            test: "bun test",
          },
          devDependencies: {
            typescript: "^5.4.0",
            "@types/bun": "latest",
          },
        },
        null,
        2,
      ),
      "tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "bundler",
            strict: true,
            outDir: "dist",
            rootDir: "src",
            skipLibCheck: true,
          },
          include: ["src"],
        },
        null,
        2,
      ),
      "src/sort.ts": `
export function sortNumbers(arr: number[]): number[] {
  return [...arr].sort();
}

export function sortDescending(arr: number[]): number[] {
  return [...arr].sort().reverse();
}

export function findMedian(arr: number[]): number {
  const sorted = sortNumbers(arr);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}
`.trim(),
      "src/sort.test.ts": `
import { test, expect } from "bun:test";
import { sortNumbers, sortDescending, findMedian } from "./sort";

test("sortNumbers basic", () => {
  expect(sortNumbers([3, 1, 2])).toEqual([1, 2, 3]);
});

test("sortNumbers with larger numbers", () => {
  expect(sortNumbers([10, 9, 2, 100, 1])).toEqual([1, 2, 9, 10, 100]);
});

test("sortDescending", () => {
  expect(sortDescending([1, 5, 3, 10, 2])).toEqual([10, 5, 3, 2, 1]);
});

test("findMedian odd length", () => {
  expect(findMedian([3, 1, 2])).toBe(2);
});

test("findMedian even length", () => {
  expect(findMedian([1, 2, 3, 4])).toBe(2.5);
});

test("findMedian with large numbers", () => {
  expect(findMedian([100, 1, 50])).toBe(50);
});
`.trim(),
    },
    task: {
      title: "Fix numeric sorting bug",
      request:
        "src/sort.ts 中的排序函数有 bug——数字按字符串排序而不是按数值排序。\n" +
        "例如 sortNumbers([10, 9, 2, 100, 1]) 返回 [1, 10, 100, 2, 9] 而不是 [1, 2, 9, 10, 100]。\n\n" +
        "修复 sortNumbers、sortDescending 和 findMedian 中的排序逻辑，确保所有现有测试通过。\n" +
        "不要修改测试文件。",
      checks: {
        build: ["bunx tsc --noEmit"],
        test: ["bun test"],
      },
      goals: [
        {
          description: "Sort bug fixed",
          criteria: "sortNumbers uses numeric comparator (a - b), not default string sort",
          priority: "blocking",
        },
        {
          description: "All tests pass",
          criteria: "All 6 tests in sort.test.ts pass without modification",
          priority: "blocking",
        },
        {
          description: "No other files changed",
          criteria: "Only src/sort.ts is modified; test file and other files unchanged",
          priority: "advisory",
        },
      ],
      budget: { maxRuns: 3, maxReplans: 1 },
    },
    expected: {
      completion: true,
      minGoalPassRate: 0.8,
      minCheckPassRate: 1.0,
    },
  },

  // ======== E3: Refactor duplicated code (Medium) ========
  {
    id: "E3",
    name: "Refactor duplicated validation",
    difficulty: "medium",
    scaffold: {
      "package.json": JSON.stringify(
        {
          name: "eval-case-e3",
          version: "1.0.0",
          scripts: {
            build: "tsc --noEmit",
            test: "bun test",
          },
          devDependencies: {
            typescript: "^5.4.0",
            "@types/bun": "latest",
          },
        },
        null,
        2,
      ),
      "tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "bundler",
            strict: true,
            outDir: "dist",
            rootDir: "src",
            skipLibCheck: true,
          },
          include: ["src"],
        },
        null,
        2,
      ),
      "src/user.ts": `
export interface User {
  name: string;
  email: string;
  age: number;
}

export function createUser(input: unknown): User {
  if (!input || typeof input !== "object") {
    throw new Error("Input must be an object");
  }
  const obj = input as Record<string, unknown>;
  if (typeof obj.name !== "string" || obj.name.trim().length === 0) {
    throw new Error("Name is required and must be a non-empty string");
  }
  if (typeof obj.email !== "string" || !obj.email.includes("@")) {
    throw new Error("Email must be a valid email address");
  }
  if (typeof obj.age !== "number" || obj.age < 0 || obj.age > 150) {
    throw new Error("Age must be a number between 0 and 150");
  }
  return { name: obj.name.trim(), email: obj.email.trim(), age: obj.age };
}

export function updateUser(existing: User, input: unknown): User {
  if (!input || typeof input !== "object") {
    throw new Error("Input must be an object");
  }
  const obj = input as Record<string, unknown>;
  const name = obj.name !== undefined ? obj.name : existing.name;
  const email = obj.email !== undefined ? obj.email : existing.email;
  const age = obj.age !== undefined ? obj.age : existing.age;

  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error("Name is required and must be a non-empty string");
  }
  if (typeof email !== "string" || !email.includes("@")) {
    throw new Error("Email must be a valid email address");
  }
  if (typeof age !== "number" || age < 0 || age > 150) {
    throw new Error("Age must be a number between 0 and 150");
  }
  return { name: (name as string).trim(), email: (email as string).trim(), age: age as number };
}
`.trim(),
      "src/user.test.ts": `
import { test, expect } from "bun:test";
import { createUser, updateUser } from "./user";

test("createUser valid", () => {
  const user = createUser({ name: "Alice", email: "alice@test.com", age: 30 });
  expect(user).toEqual({ name: "Alice", email: "alice@test.com", age: 30 });
});

test("createUser invalid name", () => {
  expect(() => createUser({ name: "", email: "a@b.com", age: 1 })).toThrow("Name");
});

test("createUser invalid email", () => {
  expect(() => createUser({ name: "X", email: "bad", age: 1 })).toThrow("Email");
});

test("createUser invalid age", () => {
  expect(() => createUser({ name: "X", email: "a@b.com", age: -1 })).toThrow("Age");
});

test("updateUser partial", () => {
  const existing = { name: "Alice", email: "alice@test.com", age: 30 };
  const updated = updateUser(existing, { age: 31 });
  expect(updated).toEqual({ name: "Alice", email: "alice@test.com", age: 31 });
});

test("updateUser invalid", () => {
  const existing = { name: "Alice", email: "alice@test.com", age: 30 };
  expect(() => updateUser(existing, { email: "bad" })).toThrow("Email");
});
`.trim(),
    },
    task: {
      title: "Refactor duplicated validation",
      request:
        "src/user.ts 中 createUser 和 updateUser 有大量重复的验证逻辑。\n\n" +
        "请重构：\n" +
        "1. 提取共享验证函数（如 validateName, validateEmail, validateAge）\n" +
        "2. createUser 和 updateUser 复用这些验证函数\n" +
        "3. 保持所有现有测试通过\n" +
        "4. 验证函数可以放在 src/validate.ts 或同一文件中\n\n" +
        "重构后每个验证逻辑应只出现一次。",
      checks: {
        build: ["bunx tsc --noEmit"],
        test: ["bun test"],
      },
      goals: [
        {
          description: "Validation logic deduplicated",
          criteria: "Each validation (name, email, age) appears only once in the codebase",
          priority: "blocking",
        },
        {
          description: "All tests pass",
          criteria: "All 6 existing tests pass without modification",
          priority: "blocking",
        },
        {
          description: "Clean separation",
          criteria: "Validation functions are well-named and reusable",
          priority: "advisory",
        },
      ],
      budget: { maxRuns: 3, maxReplans: 1 },
    },
    expected: {
      completion: true,
      minGoalPassRate: 0.8,
      minCheckPassRate: 1.0,
    },
  },

  // ======== E4: Implement a parser (Hard) ========
  {
    id: "E4",
    name: "Implement query string parser",
    difficulty: "hard",
    scaffold: {
      "package.json": JSON.stringify(
        {
          name: "eval-case-e4",
          version: "1.0.0",
          scripts: {
            build: "tsc --noEmit",
            test: "bun test",
          },
          devDependencies: {
            typescript: "^5.4.0",
            "@types/bun": "latest",
          },
        },
        null,
        2,
      ),
      "tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "bundler",
            strict: true,
            outDir: "dist",
            rootDir: "src",
            skipLibCheck: true,
          },
          include: ["src"],
        },
        null,
        2,
      ),
      "src/query.ts": `
/**
 * Parse a URL query string into a key-value map.
 *
 * Requirements:
 * - Input: "?key1=value1&key2=value2" or "key1=value1&key2=value2" (leading ? is optional)
 * - Decode URI-encoded values (%20 -> space, etc.)
 * - Support array values: "a=1&a=2" -> { a: ["1", "2"] }
 * - Support empty values: "key=" -> { key: "" }
 * - Support no-value keys: "key" -> { key: null }
 * - Ignore empty segments: "a=1&&b=2" -> { a: "1", b: "2" }
 * - Return empty object for empty/null/undefined input
 */
export function parseQuery(input: string | null | undefined): Record<string, string | string[] | null> {
  // TODO: Implement
  throw new Error("Not implemented");
}

/**
 * Serialize a key-value map back into a query string (without leading ?).
 *
 * Requirements:
 * - Encode special characters in keys and values
 * - Array values produce repeated keys: { a: ["1", "2"] } -> "a=1&a=2"
 * - null values produce bare keys: { key: null } -> "key"
 * - Empty string values produce "key="
 * - Skip undefined values
 */
export function stringifyQuery(params: Record<string, string | string[] | null | undefined>): string {
  // TODO: Implement
  throw new Error("Not implemented");
}
`.trim(),
      "src/query.test.ts": `
import { test, expect } from "bun:test";
import { parseQuery, stringifyQuery } from "./query";

// parseQuery tests
test("parse basic query", () => {
  expect(parseQuery("a=1&b=2")).toEqual({ a: "1", b: "2" });
});

test("parse with leading ?", () => {
  expect(parseQuery("?a=1&b=2")).toEqual({ a: "1", b: "2" });
});

test("parse URI-encoded values", () => {
  expect(parseQuery("name=hello%20world&path=%2Ffoo%2Fbar")).toEqual({
    name: "hello world",
    path: "/foo/bar",
  });
});

test("parse array values", () => {
  expect(parseQuery("a=1&a=2&a=3")).toEqual({ a: ["1", "2", "3"] });
});

test("parse empty value", () => {
  expect(parseQuery("key=")).toEqual({ key: "" });
});

test("parse no-value key", () => {
  expect(parseQuery("key")).toEqual({ key: null });
});

test("parse ignores empty segments", () => {
  expect(parseQuery("a=1&&b=2")).toEqual({ a: "1", b: "2" });
});

test("parse empty input", () => {
  expect(parseQuery("")).toEqual({});
  expect(parseQuery(null)).toEqual({});
  expect(parseQuery(undefined)).toEqual({});
});

// stringifyQuery tests
test("stringify basic", () => {
  expect(stringifyQuery({ a: "1", b: "2" })).toBe("a=1&b=2");
});

test("stringify encodes special chars", () => {
  const result = stringifyQuery({ name: "hello world" });
  expect(result).toBe("name=hello%20world");
});

test("stringify array values", () => {
  expect(stringifyQuery({ a: ["1", "2"] })).toBe("a=1&a=2");
});

test("stringify null value", () => {
  expect(stringifyQuery({ key: null })).toBe("key");
});

test("stringify empty value", () => {
  expect(stringifyQuery({ key: "" })).toBe("key=");
});

test("stringify skips undefined", () => {
  expect(stringifyQuery({ a: "1", b: undefined, c: "3" })).toBe("a=1&c=3");
});
`.trim(),
    },
    task: {
      title: "Implement query string parser",
      request:
        "src/query.ts 中定义了 parseQuery 和 stringifyQuery 两个函数的接口和注释，但实现抛出 NotImplemented。\n\n" +
        "请实现这两个函数，使 src/query.test.ts 中的所有测试通过。\n" +
        "不要修改测试文件，只修改 src/query.ts。\n" +
        "注意边界情况：URI 编码、数组值、空值、null/undefined 输入。",
      checks: {
        build: ["bunx tsc --noEmit"],
        test: ["bun test"],
      },
      goals: [
        {
          description: "parseQuery implemented",
          criteria: "parseQuery correctly handles all test cases including URI decoding, arrays, empty/null input",
          priority: "blocking",
        },
        {
          description: "stringifyQuery implemented",
          criteria: "stringifyQuery correctly handles encoding, arrays, null values, undefined skipping",
          priority: "blocking",
        },
        {
          description: "All tests pass",
          criteria: "All 14 tests in query.test.ts pass without modification",
          priority: "blocking",
        },
        {
          description: "Type safety",
          criteria: "TypeScript compilation succeeds with strict mode",
          priority: "advisory",
        },
      ],
      budget: { maxRuns: 3, maxReplans: 2 },
    },
    expected: {
      completion: true,
      minGoalPassRate: 0.75,
      minCheckPassRate: 1.0,
    },
  },

  // ======== E5: Multi-file feature (Hard) ========
  {
    id: "E5",
    name: "Add middleware to mini-router",
    difficulty: "hard",
    scaffold: {
      "package.json": JSON.stringify(
        {
          name: "eval-case-e5",
          version: "1.0.0",
          scripts: {
            build: "tsc --noEmit",
            test: "bun test",
          },
          devDependencies: {
            typescript: "^5.4.0",
            "@types/bun": "latest",
          },
        },
        null,
        2,
      ),
      "tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "bundler",
            strict: true,
            outDir: "dist",
            rootDir: "src",
            skipLibCheck: true,
          },
          include: ["src"],
        },
        null,
        2,
      ),
      "src/router.ts": `
export type Handler = (req: Request) => Response | Promise<Response>;

interface Route {
  method: string;
  path: string;
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  get(path: string, handler: Handler): this {
    this.routes.push({ method: "GET", path, handler });
    return this;
  }

  post(path: string, handler: Handler): this {
    this.routes.push({ method: "POST", path, handler });
    return this;
  }

  async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const route = this.routes.find(
      (r) => r.method === req.method && r.path === url.pathname
    );
    if (!route) {
      return new Response("Not Found", { status: 404 });
    }
    return route.handler(req);
  }
}
`.trim(),
      "src/router.test.ts": `
import { test, expect } from "bun:test";
import { Router } from "./router";

test("basic GET route", async () => {
  const router = new Router();
  router.get("/hello", () => new Response("Hello"));
  const res = await router.handle(new Request("http://localhost/hello"));
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("Hello");
});

test("404 for unknown route", async () => {
  const router = new Router();
  const res = await router.handle(new Request("http://localhost/missing"));
  expect(res.status).toBe(404);
});

test("POST route", async () => {
  const router = new Router();
  router.post("/data", () => new Response("OK"));
  const res = await router.handle(new Request("http://localhost/data", { method: "POST" }));
  expect(await res.text()).toBe("OK");
});
`.trim(),
      "src/middleware.test.ts": `
import { test, expect } from "bun:test";
import { Router } from "./router";
import type { Middleware } from "./router";

test("middleware runs before handler", async () => {
  const log: string[] = [];
  const router = new Router();
  router.use(async (req, next) => {
    log.push("before");
    const res = await next(req);
    log.push("after");
    return res;
  });
  router.get("/test", () => {
    log.push("handler");
    return new Response("OK");
  });
  await router.handle(new Request("http://localhost/test"));
  expect(log).toEqual(["before", "handler", "after"]);
});

test("middleware can modify response", async () => {
  const router = new Router();
  router.use(async (req, next) => {
    const res = await next(req);
    return new Response(await res.text(), {
      status: res.status,
      headers: { ...Object.fromEntries(res.headers), "X-Custom": "injected" },
    });
  });
  router.get("/test", () => new Response("Hello"));
  const res = await router.handle(new Request("http://localhost/test"));
  expect(res.headers.get("X-Custom")).toBe("injected");
});

test("multiple middleware chain", async () => {
  const order: number[] = [];
  const router = new Router();
  router.use(async (req, next) => {
    order.push(1);
    const res = await next(req);
    order.push(4);
    return res;
  });
  router.use(async (req, next) => {
    order.push(2);
    const res = await next(req);
    order.push(3);
    return res;
  });
  router.get("/test", () => {
    order.push(99);
    return new Response("OK");
  });
  await router.handle(new Request("http://localhost/test"));
  expect(order).toEqual([1, 2, 99, 3, 4]);
});

test("middleware can short-circuit", async () => {
  const router = new Router();
  router.use(async (_req, _next) => {
    return new Response("Blocked", { status: 403 });
  });
  router.get("/test", () => new Response("Should not reach"));
  const res = await router.handle(new Request("http://localhost/test"));
  expect(res.status).toBe(403);
  expect(await res.text()).toBe("Blocked");
});

test("existing routes still work without middleware", async () => {
  const router = new Router();
  router.get("/hello", () => new Response("Hello"));
  const res = await router.handle(new Request("http://localhost/hello"));
  expect(res.status).toBe(200);
});
`.trim(),
    },
    task: {
      title: "Add middleware support to Router",
      request:
        "src/router.ts 中有一个简单的 Router 类，只支持 GET/POST 路由。\n\n" +
        "请添加中间件支持：\n" +
        "1. 添加 Middleware 类型: `(req: Request, next: (req: Request) => Promise<Response>) => Promise<Response>`\n" +
        "2. 导出 Middleware 类型\n" +
        "3. 添加 `use(middleware: Middleware): this` 方法到 Router\n" +
        "4. 修改 `handle` 方法，在调用路由 handler 前执行中间件链\n" +
        "5. 中间件按注册顺序执行，形成洋葱模型（先进后出）\n" +
        "6. 中间件可以短路（不调用 next 直接返回 Response）\n\n" +
        "确保现有测试（src/router.test.ts）和新的中间件测试（src/middleware.test.ts）都通过。\n" +
        "只修改 src/router.ts。",
      checks: {
        build: ["bunx tsc --noEmit"],
        test: ["bun test"],
      },
      goals: [
        {
          description: "Middleware type exported",
          criteria: "Middleware type is exported from src/router.ts with correct signature",
          priority: "blocking",
        },
        {
          description: "use() method works",
          criteria: "Router.use() accepts middleware and returns this for chaining",
          priority: "blocking",
        },
        {
          description: "Onion model execution",
          criteria: "Multiple middleware execute in onion order (FIFO in, LIFO out)",
          priority: "blocking",
        },
        {
          description: "Backward compatible",
          criteria: "All 3 existing router.test.ts tests still pass",
          priority: "blocking",
        },
        {
          description: "All middleware tests pass",
          criteria: "All 5 tests in middleware.test.ts pass",
          priority: "blocking",
        },
      ],
      budget: { maxRuns: 4, maxReplans: 2 },
    },
    expected: {
      completion: true,
      minGoalPassRate: 0.6,
      minCheckPassRate: 1.0,
    },
  },
]

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function apiCall<T>(method: string, urlPath: string, body?: unknown, retries = 3): Promise<T> {
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  }
  if (body) opts.body = JSON.stringify(body)
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`${SERVER}${urlPath}`, opts)
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`${method} ${urlPath} -> ${res.status}: ${text}`)
      }
      return res.json() as Promise<T>
    } catch (err) {
      const isConnection = String(err).includes("ConnectionRefused") || String(err).includes("ECONNREFUSED")
      if (isConnection && attempt < retries - 1) {
        console.log(`   ${c("[WARN]", color.yellow)} Connection lost, retrying in 5s... (${attempt + 1}/${retries})`)
        await new Promise((r) => setTimeout(r, 5000))
        continue
      }
      throw err
    }
  }
  throw new Error("unreachable")
}

async function createTask(payload: EvalCase["task"]): Promise<string> {
  const body = {
    request: payload.request,
    title: payload.title,
    checks: payload.checks,
    goals: payload.goals,
    budget: payload.budget
      ? {
          maxRuns: payload.budget.maxRuns,
          maxReplans: payload.budget.maxReplans,
          maxEvaluations: 10,
          maxWallTimeMs: MAX_WAIT_MS,
        }
      : undefined,
  }
  const result = await apiCall<{ task_id: string }>("POST", "/task", body)
  return result.task_id
}

async function getProgress(taskID: string): Promise<TaskProgress> {
  return apiCall<TaskProgress>("GET", `/task/${taskID}/progress`)
}

async function getSessionMessages(sessionID: string): Promise<SessionMessage[]> {
  try {
    const msgs = await apiCall<SessionMessage[]>("GET", `/session/${sessionID}/message`)
    return Array.isArray(msgs) ? msgs : []
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Session message rendering (simulates overlay session area)
// ---------------------------------------------------------------------------

const printedMessageIDs = new Set<string>()

function renderSessionMessage(msg: SessionMessage) {
  if (printedMessageIDs.has(msg.info.id)) return
  printedMessageIDs.add(msg.info.id)

  const roleColors: Record<string, string> = {
    user: color.blue,
    assistant: color.green,
    system: color.gray,
  }
  const roleColor = roleColors[msg.info.role] ?? color.dim
  const roleLabel = msg.info.role.padEnd(9)

  for (const part of msg.parts) {
    if (part.type === "text" && part.text) {
      const lines = part.text.split("\n")
      const preview = lines[0]?.slice(0, 120) ?? ""
      const suffix = lines.length > 1 ? c(` (+${lines.length - 1} lines)`, color.dim) : ""
      console.log(`   ${c("|", color.dim)} ${c(roleLabel, roleColor)} ${preview}${suffix}`)
    } else if (part.type === "tool-invocation" && part.toolName) {
      const inputPreview = part.input ? JSON.stringify(part.input).slice(0, 80) : ""
      console.log(`   ${c("|", color.dim)} ${c(roleLabel, roleColor)} ${c("tool:", color.cyan)} ${part.toolName} ${c(inputPreview, color.dim)}`)
    } else if (part.type === "step-start") {
      console.log(`   ${c("|", color.dim)} ${c(roleLabel, roleColor)} ${c("--- step start ---", color.dim)}`)
    } else if (part.type === "step-finish") {
      console.log(`   ${c("|", color.dim)} ${c(roleLabel, roleColor)} ${c("--- step finish ---", color.dim)}`)
    }
  }
}

function renderSessionHeader(taskID: string, sessionID: string) {
  console.log(`   ${c("=== Session Area ===", color.bold + color.cyan)}`)
  console.log(`   ${c("Task:", color.dim)} ${taskID}  ${c("Session:", color.dim)} ${sessionID}`)
  console.log(`   ${c("-".repeat(60), color.dim)}`)
}

// ---------------------------------------------------------------------------
// Progress display
// ---------------------------------------------------------------------------

function renderProgressLine(progress: TaskProgress, elapsed: number) {
  const status = progress.task.status
  const phase = progress.run?.phase ?? "-"
  const executor = progress.run?.executor ?? "?"
  const attempt = progress.run?.attempt ?? 0

  const statusColors: Record<string, string> = {
    running: color.green,
    evaluating: color.yellow,
    completed: color.green + color.bold,
    failed: color.red,
    blocked: color.magenta,
    planning: color.blue,
    delivering: color.cyan,
    queued: color.dim,
  }
  const sColor = statusColors[status] ?? color.dim

  const parts = [
    c(`[${elapsed}s]`, color.dim),
    c(status.toUpperCase(), sColor),
    c(`phase=${phase}`, color.dim),
    c(`executor=${executor}`, color.dim),
    attempt > 0 ? c(`attempt=${attempt}`, color.yellow) : "",
  ].filter(Boolean)

  const goalsInfo = progress.goals.length > 0
    ? ` goals: ${progress.goals.filter((g) => g.status === "passed").length}/${progress.goals.length}`
    : ""
  const interactionInfo = progress.pendingInteractions.length > 0
    ? c(` [${progress.pendingInteractions.length} pending interactions]`, color.magenta)
    : ""

  console.log(`   ${parts.join(" ")}${goalsInfo}${interactionInfo}`)
}

// ---------------------------------------------------------------------------
// Poll with session streaming
// ---------------------------------------------------------------------------

async function pollUntilDone(taskID: string): Promise<{ progress: TaskProgress; sessionMsgCount: number; sessionFlow: string[] }> {
  const start = Date.now()
  const terminalStatuses = ["completed", "failed", "cancelled"]
  let sessionID: string | undefined
  let lastProgressStatus = ""
  let sessionMsgCount = 0
  const sessionFlow: string[] = []

  printedMessageIDs.clear()

  while (Date.now() - start < MAX_WAIT_MS) {
    const progress = await getProgress(taskID)
    const status = progress.task.status
    const elapsed = Math.round((Date.now() - start) / 1000)

    // Detect session ID from task or run
    const newSessionID = progress.task.sessionID ?? progress.run?.sessionID ?? undefined
    if (newSessionID && newSessionID !== sessionID) {
      sessionID = newSessionID
      renderSessionHeader(taskID, sessionID)
    }

    // Print status change
    if (status !== lastProgressStatus) {
      renderProgressLine(progress, elapsed)
      lastProgressStatus = status
      sessionFlow.push(`${elapsed}s: ${status}`)
    } else if (VERBOSE) {
      renderProgressLine(progress, elapsed)
    }

    // Poll session messages for real-time display
    if (sessionID) {
      const messages = await getSessionMessages(sessionID)
      for (const msg of messages) {
        renderSessionMessage(msg)
      }
      sessionMsgCount = messages.length
    }

    // Done?
    if (terminalStatuses.includes(status)) {
      return { progress, sessionMsgCount, sessionFlow }
    }

    // Auto-answer interactions (approve all permissions for eval)
    if (progress.pendingInteractions.length > 0) {
      for (const interaction of progress.pendingInteractions) {
        if (interaction.status === "pending") {
          try {
            await apiCall("POST", `/interaction/${interaction.id}/reply`, {
              reply: "always",
              message: "approved for evaluation",
            })
            console.log(`   ${c(">>", color.magenta)} Auto-approved interaction ${interaction.id} (${interaction.type})`)
          } catch {
            // ignore
          }
        }
      }
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }

  // Timeout
  const final = await getProgress(taskID)
  return { progress: final, sessionMsgCount, sessionFlow }
}

// ---------------------------------------------------------------------------
// Scaffold management
// ---------------------------------------------------------------------------

function scaffoldCase(evalCase: EvalCase, baseDir: string): string {
  const caseDir = path.join(baseDir, evalCase.id.toLowerCase())
  fs.mkdirSync(caseDir, { recursive: true })

  for (const [relPath, content] of Object.entries(evalCase.scaffold)) {
    const fullPath = path.join(caseDir, relPath)
    fs.mkdirSync(path.dirname(fullPath), { recursive: true })
    fs.writeFileSync(fullPath, content, "utf-8")
  }

  if (evalCase.scaffold["package.json"]) {
    const unixDir = toUnixPath(caseDir)
    console.log(`   Installing dependencies in ${c(unixDir, color.dim)}...`)
    const result = Bun.spawnSync(["bun", "install"], { cwd: caseDir, stdout: "pipe", stderr: "pipe" })
    if (result.exitCode !== 0) {
      console.warn(`   ${c("[WARN]", color.yellow)} bun install failed: ${result.stderr.toString().slice(0, 200)}`)
    }
  }

  return caseDir
}

function cleanupCase(caseDir: string) {
  try {
    fs.rmSync(caseDir, { recursive: true, force: true })
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function scoreResult(evalCase: EvalCase, progress: TaskProgress, wallTimeMs: number, sessionMsgCount: number, sessionFlow: string[]): EvalResult {
  const taskStatus = progress.task.status as EvalResult["status"]
  const isComplete = taskStatus === "completed"

  const checks = progress.evaluation?.checks ?? []
  const checksPassed = checks.filter((c) => c.status === "passed").length
  const checkPassRate = checks.length > 0 ? checksPassed / checks.length : 0

  const goals = progress.goals ?? []
  const goalsPassed = goals.filter((g) => g.status === "passed").length
  const goalPassRate = goals.length > 0 ? goalsPassed / goals.length : 0

  const totalRuns = (progress.run?.retryCount ?? progress.run?.attempt ?? 0) + 1

  const timeLimits = { easy: 120_000, medium: 240_000, hard: 360_000 }
  const timeLimit = timeLimits[evalCase.difficulty]
  const wallTimeScore = wallTimeMs <= timeLimit ? 100 : Math.max(0, 100 - ((wallTimeMs - timeLimit) / timeLimit) * 100)

  const scores = {
    completion: isComplete ? 100 : 0,
    checkPassRate: Math.round(checkPassRate * 100),
    goalPassRate: Math.round(goalPassRate * 100),
    efficiency: Math.round(100 / (1 + Math.max(0, totalRuns - 1))),
    wallTimeScore: Math.round(wallTimeScore),
  }

  const overall = Math.round(
    scores.completion * 0.3 +
      scores.checkPassRate * 0.25 +
      scores.goalPassRate * 0.25 +
      scores.efficiency * 0.1 +
      scores.wallTimeScore * 0.1,
  )

  return {
    caseID: evalCase.id,
    caseName: evalCase.name,
    difficulty: evalCase.difficulty,
    taskID: progress.task.id,
    status: taskStatus === "completed" || taskStatus === "failed" || taskStatus === "cancelled" ? taskStatus : "timeout",
    wallTimeMs,
    totalRuns,
    sessionMessageCount: sessionMsgCount,
    scores,
    overall,
    details: {
      planSummary: progress.plan?.summary,
      evalVerdict: progress.evaluation?.verdict,
      evalSummary: progress.evaluation?.summary,
      checks: progress.evaluation?.checks?.map((c) => ({ name: c.name, status: c.status })),
      goals: progress.goals?.map((g) => ({ description: g.description, status: g.status })),
      changedFiles: progress.delivery?.result?.changed_files,
      error: progress.task.error,
      sessionFlow,
    },
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function printReport(results: EvalResult[]) {
  console.log("\n" + c("=".repeat(80), color.bold))
  console.log(c("  OPENCORVUS E2E EVALUATION REPORT", color.bold + color.cyan))
  console.log(c("=".repeat(80), color.bold))
  console.log(`  ${c("Date:", color.dim)} ${new Date().toISOString()}`)
  console.log(`  ${c("Server:", color.dim)} ${SERVER}`)
  console.log(`  ${c("Model:", color.dim)} ${MODEL}`)
  console.log(`  ${c("Cases:", color.dim)} ${results.length}`)
  console.log("")

  // Summary table
  console.log(c("  ID   | Difficulty | Status     | Score | Comp | Check | Goal | Eff  | Time | Msgs", color.bold))
  console.log("  " + "-".repeat(85))

  for (const r of results) {
    const status = r.status.padEnd(10)
    const statusColor = r.status === "completed" ? color.green : r.status === "failed" ? color.red : color.yellow
    const score = String(r.overall).padStart(3)
    const comp = String(r.scores.completion).padStart(3)
    const check = String(r.scores.checkPassRate).padStart(3)
    const goal = String(r.scores.goalPassRate).padStart(3)
    const eff = String(r.scores.efficiency).padStart(3)
    const time = String(r.scores.wallTimeScore).padStart(3)
    const msgs = String(r.sessionMessageCount).padStart(4)
    console.log(`  ${r.caseID.padEnd(4)} | ${r.difficulty.padEnd(10)} | ${c(status, statusColor)} | ${score}%  | ${comp}% | ${check}%  | ${goal}% | ${eff}% | ${time}% | ${msgs}`)
  }

  // Overall
  const avgScore = Math.round(results.reduce((s, r) => s + r.overall, 0) / results.length)
  console.log("  " + "-".repeat(85))
  console.log(`  AVERAGE                            | ${String(avgScore).padStart(3)}%  |`)
  console.log("")

  // Session flow summary
  console.log(c("  Session Information Flow:", color.bold))
  for (const r of results) {
    const msgIcon = r.sessionMessageCount > 0 ? c("OK", color.green) : c("EMPTY", color.red)
    console.log(`  ${r.caseID}: ${r.sessionMessageCount} messages [${msgIcon}]`)
    if (r.details.sessionFlow && r.details.sessionFlow.length > 0) {
      console.log(`    ${c("Flow:", color.dim)} ${r.details.sessionFlow.join(" -> ")}`)
    }
  }
  console.log("")

  // Detailed results
  for (const r of results) {
    console.log(`  ${c(`--- ${r.caseID}: ${r.caseName} ---`, color.bold)}`)
    console.log(`  Status: ${r.status} | Runs: ${r.totalRuns} | Wall: ${Math.round(r.wallTimeMs / 1000)}s | Session msgs: ${r.sessionMessageCount}`)
    if (r.details.planSummary) {
      console.log(`  Plan: ${r.details.planSummary.slice(0, 100)}`)
    }
    if (r.details.evalVerdict) {
      console.log(`  Eval: ${r.details.evalVerdict} -- ${r.details.evalSummary?.slice(0, 100)}`)
    }
    if (r.details.checks && r.details.checks.length > 0) {
      for (const ck of r.details.checks) {
        const icon = ck.status === "passed" ? c("PASS", color.green) : c("FAIL", color.red)
        console.log(`    [${icon}] ${ck.name}`)
      }
    }
    if (r.details.goals && r.details.goals.length > 0) {
      for (const g of r.details.goals) {
        const icon = g.status === "passed" ? c("PASS", color.green) : g.status === "failed" ? c("FAIL", color.red) : c("????", color.yellow)
        console.log(`    [${icon}] ${g.description}`)
      }
    }
    if (r.details.changedFiles && r.details.changedFiles.length > 0) {
      console.log(`  Changed: ${r.details.changedFiles.join(", ")}`)
    }
    if (r.details.error) {
      console.log(`  ${c("Error:", color.red)} ${r.details.error.slice(0, 200)}`)
    }
    console.log("")
  }

  // Save JSON report
  const reportPath = path.join(
    process.cwd(),
    `eval-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  )
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2))
  console.log(`  ${c("Report saved:", color.dim)} ${reportPath}`)
  console.log(c("=".repeat(80), color.bold))
}

// ---------------------------------------------------------------------------
// Server management
// ---------------------------------------------------------------------------

let serverProc: ReturnType<typeof Bun.spawn> | undefined

async function startServer(): Promise<void> {
  const binaryPath = path.resolve(process.cwd(), "dist/opencorvus-windows-x64/opencorvus.exe")
  if (!fs.existsSync(binaryPath)) {
    console.error(`Binary not found at ${binaryPath}`)
    console.error("Build first: bun run script/build.local.ts --single --binary-only")
    process.exit(1)
  }

  console.log(`Starting server: ${c(binaryPath, color.dim)}`)
  serverProc = Bun.spawn([binaryPath, "serve", "--port", "7878"], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      OPENCORVUS_CHANNEL: "local",
    },
  })

  // Wait for server to be ready
  const maxWait = 30_000
  const start = Date.now()
  while (Date.now() - start < maxWait) {
    try {
      const res = await fetch(`${SERVER}/tasks`)
      if (res.ok) {
        console.log(`Server ready at ${c(SERVER, color.cyan)}`)
        return
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`Server failed to start within ${maxWait / 1000}s`)
}

function stopServer() {
  if (serverProc) {
    console.log("Stopping server...")
    serverProc.kill()
    serverProc = undefined
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function runCase(evalCase: EvalCase): Promise<EvalResult> {
  console.log(`\n${c(">>", color.bold)} Running ${c(evalCase.id, color.bold + color.cyan)}: ${evalCase.name} [${evalCase.difficulty}]`)

  // 1. Scaffold
  const baseDir = await evalWorkspaceDir()
  const caseDir = scaffoldCase(evalCase, baseDir)
  console.log(`   Scaffolded to: ${c(toUnixPath(caseDir), color.dim)}`)

  // 2. Build modified task request with working directory
  const unixDir = toUnixPath(caseDir)
  let relDir = unixDir
  try {
    const tasks = await apiCall<{ project: { worktree: string } }>("GET", "/tasks")
    const worktree = toUnixPath(tasks.project.worktree)
    if (unixDir.startsWith(worktree)) {
      relDir = unixDir.slice(worktree.length + 1)
    }
  } catch { /* use absolute */ }

  const modifiedTask = {
    ...evalCase.task,
    request:
      `## 工作目录\n\n` +
      `本任务的工作目录是 \`${relDir}\`（绝对路径: ${unixDir}）。\n` +
      `所有源代码文件都在这个目录下。请先用以下命令切换到工作目录：\n` +
      `\`\`\`bash\ncd "${unixDir}"\n\`\`\`\n\n` +
      `然后查看目录结构和文件内容，理解当前代码后再开始修改。\n\n` +
      `## 任务描述\n\n` +
      evalCase.task.request,
    checks: evalCase.task.checks
      ? Object.fromEntries(
          Object.entries(evalCase.task.checks).map(([key, val]) => {
            if (Array.isArray(val)) {
              return [key, val.map((cmd: string) => `cd "${unixDir}" && ${cmd}`)]
            }
            return [key, val]
          }),
        )
      : undefined,
    budget: {
      maxRuns: evalCase.task.budget?.maxRuns ?? 2,
      maxReplans: evalCase.task.budget?.maxReplans ?? 1,
      maxEvaluations: 5,
      maxWallTimeMs: MAX_WAIT_MS,
    },
  }

  if (DRY_RUN) {
    console.log("   [DRY RUN] Task payload:")
    console.log(JSON.stringify(modifiedTask, null, 2).split("\n").map((l) => "   " + l).join("\n"))
    return {
      caseID: evalCase.id,
      caseName: evalCase.name,
      difficulty: evalCase.difficulty,
      taskID: "dry-run",
      status: "completed",
      wallTimeMs: 0,
      totalRuns: 1,
      sessionMessageCount: 0,
      scores: { completion: 0, checkPassRate: 0, goalPassRate: 0, efficiency: 100, wallTimeScore: 100 },
      overall: 0,
      details: {},
    }
  }

  // 3. Submit task
  const startTime = Date.now()
  let taskID: string
  try {
    taskID = await createTask(modifiedTask)
    console.log(`   Task created: ${c(taskID, color.cyan)}`)
  } catch (err) {
    console.error(`   ${c("Failed to create task:", color.red)} ${err}`)
    cleanupCase(baseDir)
    return {
      caseID: evalCase.id,
      caseName: evalCase.name,
      difficulty: evalCase.difficulty,
      taskID: "error",
      status: "failed",
      wallTimeMs: 0,
      totalRuns: 0,
      sessionMessageCount: 0,
      scores: { completion: 0, checkPassRate: 0, goalPassRate: 0, efficiency: 0, wallTimeScore: 0 },
      overall: 0,
      details: { error: String(err) },
    }
  }

  // 4. Poll with real-time session display
  console.log(`   Polling (max ${MAX_WAIT_MS / 1000}s)...`)
  const { progress, sessionMsgCount, sessionFlow } = await pollUntilDone(taskID)
  const wallTimeMs = Date.now() - startTime

  // Print final session messages
  const finalSessionID = progress.task.sessionID ?? progress.run?.sessionID
  if (finalSessionID) {
    const finalMsgs = await getSessionMessages(finalSessionID)
    for (const msg of finalMsgs) {
      renderSessionMessage(msg)
    }
  }

  console.log(`   ${c("-".repeat(60), color.dim)}`)
  console.log(`   Done: ${c(progress.task.status.toUpperCase(), progress.task.status === "completed" ? color.green : color.red)} (${Math.round(wallTimeMs / 1000)}s, ${sessionMsgCount} session messages)`)

  // 5. Score
  const result = scoreResult(evalCase, progress, wallTimeMs, sessionMsgCount, sessionFlow)
  return result
}

async function main() {
  console.log(c("OpenCorvus E2E Evaluation", color.bold + color.cyan))
  console.log(`${c("Server:", color.dim)} ${SERVER}`)
  console.log(`${c("Model:", color.dim)} ${MODEL}`)
  console.log(`${c("Dry run:", color.dim)} ${DRY_RUN}`)
  console.log(`${c("Auto-start:", color.dim)} ${START_SERVER}`)

  // Auto-start server if requested
  if (START_SERVER) {
    await startServer()
  }

  // Check server is reachable
  if (!DRY_RUN) {
    try {
      const res = await fetch(`${SERVER}/tasks`)
      if (!res.ok) throw new Error(`Server returned ${res.status}`)
      const body = await res.json() as { project?: { worktree?: string } }
      console.log(`${c("Project:", color.dim)} ${body.project?.worktree ?? "unknown"}`)
    } catch (err) {
      console.error(`${c("Cannot reach server:", color.red)} ${SERVER}: ${err}`)
      stopServer()
      process.exit(1)
    }
  }

  // Filter cases
  const cases = CASE_FILTER ? CASES.filter((c) => c.id === CASE_FILTER) : CASES
  if (cases.length === 0) {
    console.error(`No cases matching filter: ${CASE_FILTER}`)
    console.error(`Available: ${CASES.map((c) => c.id).join(", ")}`)
    stopServer()
    process.exit(1)
  }

  console.log(`Running ${cases.length} case(s): ${cases.map((c) => c.id).join(", ")}`)

  const results: EvalResult[] = []
  try {
    for (const evalCase of cases) {
      const result = await runCase(evalCase)
      results.push(result)
    }
  } finally {
    stopServer()
  }

  printReport(results)
}

main().catch((err) => {
  console.error("Fatal:", err)
  stopServer()
  process.exit(1)
})
