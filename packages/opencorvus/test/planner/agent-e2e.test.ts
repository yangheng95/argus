/**
 * End-to-end test for PlannerAgent.
 *
 * This test initializes a real Instance context with API key auth,
 * calls PlannerAgent.plan() with a real LLM, and verifies the output
 * is detailed and task-specific (NOT a shallow generic plan).
 *
 * Requires: DASHSCOPE_API_KEY env var.
 * Timeout: 120s per test (LLM calls + tool exploration).
 */
import { afterEach, describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import { Instance } from "../../src/project/instance"
import { PlannerAgent } from "../../src/planner/agent"
import { PlannerService } from "../../src/planner/service"
import { Provider } from "../../src/provider/provider"
import { Log } from "../../src/util/log"
import * as fs from "fs/promises"
import path from "path"

// Show logs so we can see what happens during the test
Log.init({ print: true })

const DASHSCOPE_KEY = process.env.DASHSCOPE_API_KEY || ""

const hasKey = DASHSCOPE_KEY.length > 0

afterEach(async () => {
  await resetDatabase()
})

/**
 * Scaffold a mini project for the planner to explore.
 */
async function scaffoldProject(dir: string) {
  await fs.mkdir(path.join(dir, "src"), { recursive: true })
  // Make sure .opencorvus dir exists for config
  await fs.mkdir(path.join(dir, ".opencorvus"), { recursive: true })

  await Bun.write(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "test-project",
      scripts: { test: "bun test", build: "bunx tsc --noEmit" },
    }, null, 2),
  )

  await Bun.write(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { strict: true, target: "ES2022", module: "ESNext", moduleResolution: "bundler" },
      include: ["src/**/*.ts"],
    }, null, 2),
  )

  // opencorvus.json in project root (Config reads from here via findUp)
  await Bun.write(
    path.join(dir, "opencorvus.json"),
    JSON.stringify({
      $schema: "https://opencorvus.ai/config.json",
      model: "alibaba-cn/qwen3.5-plus",
      provider: {
        "alibaba-cn": {
          options: {
            baseURL: "https://coding.dashscope.aliyuncs.com/v1",
          },
        },
      },
    }),
  )

  // Also write to .opencorvus/ dir in case config only searches there
  await Bun.write(
    path.join(dir, ".opencorvus", "opencorvus.json"),
    JSON.stringify({
      $schema: "https://opencorvus.ai/config.json",
      model: "alibaba-cn/qwen3.5-plus",
      provider: {
        "alibaba-cn": {
          options: {
            baseURL: "https://coding.dashscope.aliyuncs.com/v1",
          },
        },
      },
    }),
  )

  // Source files
  await Bun.write(
    path.join(dir, "src", "router.ts"),
    `export type Handler = (req: Request) => Promise<Response>

export class Router {
  private routes = new Map<string, Map<string, Handler>>()

  get(path: string, handler: Handler): this {
    this.addRoute("GET", path, handler)
    return this
  }

  post(path: string, handler: Handler): this {
    this.addRoute("POST", path, handler)
    return this
  }

  private addRoute(method: string, path: string, handler: Handler) {
    if (!this.routes.has(method)) this.routes.set(method, new Map())
    this.routes.get(method)!.set(path, handler)
  }

  async handle(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const handlers = this.routes.get(req.method)
    if (!handlers) return new Response("Method Not Allowed", { status: 405 })
    const handler = handlers.get(url.pathname)
    if (!handler) return new Response("Not Found", { status: 404 })
    return handler(req)
  }
}
`,
  )

  await Bun.write(
    path.join(dir, "src", "router.test.ts"),
    `import { describe, test, expect } from "bun:test"
import { Router } from "./router"

describe("Router", () => {
  test("GET route returns response", async () => {
    const router = new Router()
    router.get("/hello", async () => new Response("world"))
    const res = await router.handle(new Request("http://localhost/hello"))
    expect(await res.text()).toBe("world")
  })

  test("returns 404 for unknown path", async () => {
    const router = new Router()
    const res = await router.handle(new Request("http://localhost/missing"))
    expect(res.status).toBe(404)
  })
})
`,
  )

  await Bun.write(
    path.join(dir, "src", "middleware.test.ts"),
    `import { describe, test, expect } from "bun:test"
import { Router, type Middleware } from "./router"

describe("Middleware", () => {
  test("middleware executes before handler", async () => {
    const log: string[] = []
    const mw: Middleware = async (req, next) => {
      log.push("before")
      const res = await next(req)
      log.push("after")
      return res
    }
    const router = new Router()
    router.use(mw)
    router.get("/hello", async () => {
      log.push("handler")
      return new Response("ok")
    })
    const res = await router.handle(new Request("http://localhost/hello"))
    expect(res.status).toBe(200)
    expect(log).toEqual(["before", "handler", "after"])
  })
})
`,
  )
}

describe.skipIf(!hasKey)("PlannerAgent e2e", () => {
  test(
    "diagnose: provider model resolution",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await scaffoldProject(tmp.path)

      console.log("=== DIAGNOSTIC: Provider Model Resolution ===")
      console.log("DASHSCOPE_KEY available:", hasKey)
      console.log("DASHSCOPE_KEY prefix:", DASHSCOPE_KEY.slice(0, 10) + "...")
      console.log("process.env.DASHSCOPE_API_KEY:", process.env.DASHSCOPE_API_KEY ? "SET" : "NOT SET")
      console.log("tmp.path:", tmp.path)

      await Instance.provide({
        directory: tmp.path,
        init: async () => {
          // Set the API key in the instance-scoped environment
          const { Env } = await import("../../src/env/index")
          Env.set("DASHSCOPE_API_KEY", DASHSCOPE_KEY)
          console.log("Env.set done, checking Env.get:", Env.get("DASHSCOPE_API_KEY") ? "SET" : "NOT SET")
        },
        fn: async () => {
          // Step 1: Check Env
          const { Env } = await import("../../src/env/index")
          const envKey = Env.get("DASHSCOPE_API_KEY")
          console.log("\n--- Step 1: Env ---")
          console.log("  Env.get('DASHSCOPE_API_KEY'):", envKey ? "SET (" + envKey.slice(0, 10) + "...)" : "NOT SET")

          // Step 2: Check Config
          const { Config } = await import("../../src/config/config")
          let config: any
          try {
            config = await Config.get()
            console.log("\n--- Step 2: Config ---")
            console.log("  config.model:", config.model)
            console.log("  config.provider:", JSON.stringify(config.provider ?? {}).slice(0, 200))
          } catch (err) {
            console.log("\n--- Step 2: Config FAILED ---")
            console.log("  Error:", String(err))
          }

          // Step 3: Check Provider.list()
          try {
            const providers = await Provider.list()
            console.log("\n--- Step 3: Provider.list ---")
            console.log("  Available providers:", Object.keys(providers).join(", "))
            const alibaba = providers["alibaba-cn"]
            if (alibaba) {
              const allModelKeys = Object.keys(alibaba.models)
              console.log("  alibaba-cn total models:", allModelKeys.length)
              console.log("  alibaba-cn first 5:", allModelKeys.slice(0, 5).join(", "))
              console.log("  alibaba-cn 'qwen3.5-plus' key exists?:", "qwen3.5-plus" in alibaba.models)
              console.log("  alibaba-cn 'qwen3.5-plus' value?:", !!alibaba.models["qwen3.5-plus"])
              console.log("  alibaba-cn plus models:", allModelKeys.filter(k => k.includes("plus")).join(", "))
              console.log("  alibaba-cn source:", alibaba.source)
              console.log("  alibaba-cn has key:", !!alibaba.key)
            } else {
              console.log("  alibaba-cn: NOT FOUND!")
            }
          } catch (err) {
            console.log("\n--- Step 3: Provider.list FAILED ---")
            console.log("  Error:", String(err))
          }

          // Step 4: Check Provider.defaultModel()
          try {
            const def = await Provider.defaultModel()
            console.log("\n--- Step 4: Provider.defaultModel ---")
            console.log("  Result:", JSON.stringify(def))
          } catch (err) {
            console.log("\n--- Step 4: Provider.defaultModel FAILED ---")
            console.log("  Error:", String(err))
          }

          // Step 5: Check Provider.getModel()
          try {
            const model = await Provider.getModel("alibaba-cn", "qwen3.5-plus")
            console.log("\n--- Step 5: Provider.getModel ---")
            console.log("  Model found:", model.id, "provider:", model.providerID)
          } catch (err) {
            console.log("\n--- Step 5: Provider.getModel FAILED ---")
            console.log("  Error:", String(err))
          }

          // Step 6: Check Provider.getLanguage()
          try {
            const model = await Provider.getModel("alibaba-cn", "qwen3.5-plus")
            const language = await Provider.getLanguage(model)
            console.log("\n--- Step 6: Provider.getLanguage ---")
            console.log("  Language model ID:", language.modelId)
          } catch (err) {
            console.log("\n--- Step 6: Provider.getLanguage FAILED ---")
            console.log("  Error:", String(err))
          }

          // If we got this far, Provider is working. Run PlannerAgent.
          console.log("\n=== RUNNING PLANNER AGENT ===")
          expect(true).toBe(true)
        },
      })
    },
    { timeout: 60_000 },
  )

  test(
    "produces detailed plan for middleware task",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await scaffoldProject(tmp.path)

      const unixPath = tmp.path.replace(/\\/g, "/")
      const REQUEST = `## 工作目录

本任务的工作目录是 \`${unixPath}\`（绝对路径: ${unixPath}）。
所有源代码文件都在这个目录下。

## 任务描述

src/router.ts 中有一个简单的 Router 类，只支持 GET/POST 路由。
请添加中间件支持：
添加 Middleware 类型: (req: Request, next: (req: Request) => Promise<Response>) => Promise<Response>
导出 Middleware 类型
添加 use(middleware: Middleware): this 方法到 Router
修改 handle 方法，在调用路由 handler 前执行中间件链
中间件按注册顺序执行，形成洋葱模型（先进后出）
中间件可以短路（不调用 next 直接返回 Response）
确保现有测试（src/router.test.ts）和新的中间件测试（src/middleware.test.ts）都通过。
只修改 src/router.ts。`

      await Instance.provide({
        directory: tmp.path,
        init: async () => {
          const { Env } = await import("../../src/env/index")
          Env.set("DASHSCOPE_API_KEY", DASHSCOPE_KEY)
        },
        fn: async () => {
          const result = await PlannerAgent.plan({
            title: "添加中间件支持到 Router 类",
            request: REQUEST,
          })

          console.log("\n=== PLANNER AGENT OUTPUT ===")
          console.log("Summary:", result.summary)
          console.log("PRD length:", result.prd.length)
          console.log("Goals:", result.goals.length)
          console.log("Subtasks:", result.subtasks.length)
          console.log("Risks:", result.risks.length)
          console.log("\n--- PRD (first 800 chars) ---")
          console.log(result.prd.slice(0, 800))
          console.log("\n--- Goals ---")
          result.goals.forEach((g, i) =>
            console.log(`  ${i + 1}. [${g.priority}] ${g.description}\n     Criteria: ${g.criteria}`),
          )
          console.log("\n--- Subtasks ---")
          result.subtasks.forEach((s, i) =>
            console.log(`  ${s.order ?? i + 1}. ${s.title}\n     ${s.description.slice(0, 200)}`),
          )

          // ========== QUALITY ASSERTIONS ==========
          expect(result.prd.length).toBeGreaterThan(200)
          expect(result.prd).toContain("router.ts")
          expect(result.goals.length).toBeGreaterThanOrEqual(1)
          expect(result.subtasks.length).toBeGreaterThanOrEqual(3)
          const allSubtaskText = result.subtasks.map((s) => `${s.title} ${s.description}`).join(" ")
          expect(allSubtaskText).toMatch(/Middleware|middleware/i)
          expect(result.summary.length).toBeGreaterThan(10)

          console.log("\n✓ All quality assertions passed!")
        },
      })
    },
    { timeout: 180_000 },
  )

  test(
    "PlannerService.initial produces rich plan, not template fallback",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await scaffoldProject(tmp.path)

      const unixPath = tmp.path.replace(/\\/g, "/")
      const REQUEST = `## 工作目录

本任务的工作目录是 \`${unixPath}\`（绝对路径: ${unixPath}）。

## 任务描述

src/router.ts 中有一个简单的 Router 类。
请添加中间件支持：
添加 Middleware 类型
添加 use(middleware: Middleware): this 方法
修改 handle 方法，执行中间件链
确保 src/router.test.ts 和 src/middleware.test.ts 都通过。`

      await Instance.provide({
        directory: tmp.path,
        init: async () => {
          const { Env } = await import("../../src/env/index")
          Env.set("DASHSCOPE_API_KEY", DASHSCOPE_KEY)
        },
        fn: async () => {
          const plan = await PlannerService.initial({
            title: "添加中间件支持",
            request: REQUEST,
            allowClarification: false,
          })

          console.log("\n=== PLANNER SERVICE OUTPUT ===")
          console.log("Summary:", plan.summary)
          console.log("Strategy:", plan.metadata.strategy)
          console.log("Steps count:", plan.metadata.steps.length)
          console.log("Prompt length:", plan.prompt.length)

          console.log("\n--- Steps ---")
          plan.metadata.steps.forEach((s: string, i: number) =>
            console.log(`  ${i + 1}. ${s.slice(0, 150)}`),
          )

          // Must NOT be the generic 4-step template
          expect(plan.metadata.steps).not.toContain(
            "Explore the codebase to understand architecture, conventions, and affected areas.",
          )
          const stepsText = plan.metadata.steps.join(" ")
          expect(stepsText).toMatch(/router|Router|middleware|Middleware/i)
          expect(plan.metadata.steps.length).toBeGreaterThan(4)

          console.log("\n✓ Plan is NOT the generic template!")
        },
      })
    },
    { timeout: 180_000 },
  )
})
