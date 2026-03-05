import z from "zod"
import { Tool } from "./tool"
import { Automation, AutomationRuntime, selectDriver } from "../opencorvus/automation"

const DESCRIPTION = `Run selector-based GUI automation flows with retry and recovery.

Use this tool for Playwright (web) or Appium (mobile) sessions, either attached from globalThis or started as managed runtime.

Actions:
- status: Show whether Playwright/Appium runtime context is attached.
- attach: Attach Playwright/Appium runtime from globalThis references.
- clear: Clear attached runtime context.
- start: Start managed Playwright browser runtime and create an initial tab.
- stop: Stop managed Playwright browser runtime.
- open: Navigate the current Playwright tab to a URL.
- new_tab: Create a new Playwright tab and optionally open a URL.
- switch_tab: Switch the active Playwright tab by index.
- list_tabs: List current Playwright tabs and active index.
- close_tab: Close a Playwright tab by index (defaults to active tab).
- run: Execute one step or a flow of steps with locate/pre/act/post checks.

Driver:
- auto (default): prefers Playwright, then Appium.
- playwright: require Playwright runtime.
- appium: require Appium runtime.

Locator notes:
- image locator currently matches accessibility/metadata fields (e.g. alt/aria-label/content-desc/resource-id), not pixel template matching.

Step helpers:
- post_template: quick post-check template: "none" | "exists" | "visible" | "enabled" | "focused" | "stable".
- recover_on: when to trigger recovery for a failed attempt (defaults to: not_interactable/state_mismatch/infra).`

const Locator = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("aid"),
    value: z.string().min(1),
    weight: z.number().optional(),
  }),
  z.object({
    kind: z.literal("role"),
    value: z.string().min(1),
    name: z.string().optional(),
    weight: z.number().optional(),
  }),
  z.object({
    kind: z.literal("text"),
    value: z.string().min(1),
    exact: z.boolean().optional(),
    weight: z.number().optional(),
  }),
  z.object({
    kind: z.literal("image"),
    value: z.string().min(1),
    threshold: z.number().optional(),
    weight: z.number().optional(),
  }),
])

const Check = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("exists") }),
  z.object({ kind: z.literal("visible") }),
  z.object({ kind: z.literal("enabled") }),
  z.object({ kind: z.literal("focused") }),
  z.object({ kind: z.literal("stable") }),
  z.object({
    kind: z.literal("state"),
    key: z.string().min(1),
    value: z.union([z.string(), z.number(), z.boolean()]),
  }),
])

const Action = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("click"),
    button: z.enum(["left", "right", "middle", "double"]).optional(),
  }),
  z.object({
    kind: z.literal("type"),
    text: z.string(),
  }),
  z.object({
    kind: z.literal("hotkey"),
    keys: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    kind: z.literal("scroll"),
    direction: z.enum(["up", "down"]),
    amount: z.number().int().optional(),
  }),
  z.object({
    kind: z.literal("wait"),
    ms: z.number().int().min(0),
  }),
  z.object({
    kind: z.literal("custom"),
    name: z.string().min(1),
    data: z.record(z.string(), z.unknown()).optional(),
  }),
])

const Retry = z.object({
  max: z.number().int().min(1).max(10).optional(),
  backoffMs: z.array(z.number().int().min(0)).optional(),
})

const RecoverKind = z.enum(["not_found", "not_interactable", "state_mismatch", "infra", "timeout", "aborted"])
const CheckTemplate = z.enum(["none", "exists", "visible", "enabled", "focused", "stable"])

const Step = z.object({
  id: z.string().min(1),
  target: z.array(Locator).min(1).optional(),
  pre: z.array(Check).optional(),
  act: Action,
  post: z.array(Check).optional(),
  post_template: CheckTemplate.optional(),
  recover_on: z.array(RecoverKind).min(1).optional(),
  timeoutMs: z.number().int().min(1).max(120000).optional(),
  intervalMs: z.number().int().min(0).max(10000).optional(),
  retry: Retry.optional(),
})

const Driver = z.enum(["auto", "playwright", "appium"]).optional()
const WaitUntil = z.enum(["load", "domcontentloaded", "networkidle"]).optional()

const Run = z
  .object({
    action: z.literal("run"),
    driver: Driver.describe("auto (default), playwright, or appium"),
    step: Step.optional(),
    steps: z.array(Step).min(1).optional(),
    stopOnFail: z.boolean().optional(),
    timeoutMs: z.number().int().min(1).max(120000).optional(),
    intervalMs: z.number().int().min(0).max(10000).optional(),
    retryMax: z.number().int().min(1).max(10).optional(),
    backoffMs: z.array(z.number().int().min(0)).optional(),
    post_template: CheckTemplate.optional(),
  })
  .refine((x) => !!x.step || !!x.steps, { message: "Provide either step or steps." })
  .refine((x) => !(x.step && x.steps), { message: "Use step or steps, not both." })

const Params = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("status"),
  }),
  z.object({
    action: z.literal("attach"),
    playwright_global: z.string().min(1).optional().describe("globalThis key that stores a Playwright page"),
    playwright_launcher_global: z
      .string()
      .min(1)
      .optional()
      .describe("globalThis key that stores a Playwright launcher (module with chromium.launch)"),
    appium_global: z.string().min(1).optional().describe("globalThis key that stores an Appium/WebDriver client"),
    appium_app_id: z.string().min(1).optional().describe("Optional app id for activate-app recovery"),
  }),
  z.object({
    action: z.literal("clear"),
    kind: z.enum(["playwright", "appium", "all"]).default("all").optional(),
  }),
  z.object({
    action: z.literal("start"),
    headless: z.boolean().optional().describe("Launch Playwright Chromium in headless mode (default: true)"),
    url: z.string().min(1).optional().describe("Optional initial URL to open after startup"),
    wait_until: WaitUntil.describe("Navigation wait strategy: load, domcontentloaded, or networkidle"),
    timeoutMs: z.number().int().min(1).max(120000).optional().describe("Optional navigation timeout in ms"),
    playwright_launcher_global: z
      .string()
      .min(1)
      .optional()
      .describe("Optional launcher global key override used for start"),
  }),
  z.object({
    action: z.literal("stop"),
  }),
  z.object({
    action: z.literal("open"),
    url: z.string().min(1).describe("URL to open in the active Playwright tab"),
    wait_until: WaitUntil.describe("Navigation wait strategy: load, domcontentloaded, or networkidle"),
    timeoutMs: z.number().int().min(1).max(120000).optional().describe("Optional navigation timeout in ms"),
  }),
  z.object({
    action: z.literal("new_tab"),
    url: z.string().min(1).optional().describe("Optional URL to open in the new tab"),
    wait_until: WaitUntil.describe("Navigation wait strategy: load, domcontentloaded, or networkidle"),
    timeoutMs: z.number().int().min(1).max(120000).optional().describe("Optional navigation timeout in ms"),
  }),
  z.object({
    action: z.literal("switch_tab"),
    index: z.number().int().min(0).describe("Tab index to activate"),
  }),
  z.object({
    action: z.literal("list_tabs"),
  }),
  z.object({
    action: z.literal("close_tab"),
    index: z.number().int().min(0).optional().describe("Optional tab index to close (defaults to active tab)"),
  }),
  Run,
])

function ready(driver: z.infer<typeof Driver>, runtime: ReturnType<typeof AutomationRuntime.status>) {
  if (driver === "playwright") return runtime.playwright
  if (driver === "appium") return runtime.appium
  return runtime.playwright || runtime.appium
}

function missing(driver: z.infer<typeof Driver>, runtime: ReturnType<typeof AutomationRuntime.status>) {
  if (driver === "playwright") {
    return "Playwright runtime is not attached. Register it with AutomationRuntime.setPlaywright(page)."
  }
  if (driver === "appium") {
    return "Appium runtime is not attached. Register it with AutomationRuntime.setAppium(client)."
  }
  if (runtime.playwright || runtime.appium) return ""
  return "No automation runtime attached. Register Playwright or Appium first."
}

function compact(step: Automation.StepResult) {
  return {
    id: step.id,
    ok: step.ok,
    tries: step.tries,
    kind: step.kind,
    detail: step.detail,
    stages: step.trace.map((x) => ({
      stage: x.stage,
      ok: x.ok,
      kind: x.kind,
      detail: x.detail,
      check: x.check,
      shot: x.shot,
    })),
  }
}

function template(name: z.infer<typeof CheckTemplate> | undefined) {
  if (!name || name === "none") return undefined
  return [{ kind: name } satisfies Automation.Check]
}

function normalize(step: z.infer<typeof Step>, post: z.infer<typeof CheckTemplate> | undefined): Automation.Step {
  return {
    id: step.id,
    target: step.target,
    pre: step.pre,
    act: step.act,
    post: step.post ?? template(step.post_template ?? post),
    recoverOn: step.recover_on,
    timeoutMs: step.timeoutMs,
    intervalMs: step.intervalMs,
    retry: step.retry,
  }
}

function failed(result: { detail?: string; reason?: string }) {
  return result.detail ?? result.reason ?? "Unknown error"
}

export const AutomationTool = Tool.define("automation", {
  description: DESCRIPTION,
  parameters: Params,
  async execute(params, ctx): Promise<{ title: string; output: string; metadata: Record<string, any> }> {
    await ctx.ask({
      permission: "input",
      patterns: ["automation"],
      always: ["*"],
      metadata: { action: params.action },
    })

    if (params.action === "status") {
      const runtime = AutomationRuntime.status()
      return {
        title: "Automation runtime status",
        output: JSON.stringify(runtime),
        metadata: runtime,
      }
    }
    if (params.action === "attach") {
      const attached = AutomationRuntime.attach({
        playwrightGlobal: params.playwright_global,
        playwrightLauncherGlobal: params.playwright_launcher_global,
        appiumGlobal: params.appium_global,
        appiumAppId: params.appium_app_id,
      })
      const ok = attached.playwright || attached.playwrightLauncher || attached.appium
      return {
        title: ok ? "Automation runtime attached" : "Automation runtime attach skipped",
        output:
          ok
            ? JSON.stringify(attached)
            : `No runtime found on globalThis. Expected keys: playwright=${attached.globals.playwright}, launcher=${attached.globals.playwrightLauncher}, appium=${attached.globals.appium}.`,
        metadata: attached,
      }
    }
    if (params.action === "clear") {
      if (params.kind === "all") AutomationRuntime.clear()
      if (params.kind === "playwright") AutomationRuntime.clear("playwright")
      if (params.kind === "appium") AutomationRuntime.clear("appium")
      const runtime = AutomationRuntime.status()
      return {
        title: "Automation runtime cleared",
        output: JSON.stringify(runtime),
        metadata: runtime,
      }
    }
    if (params.action === "start") {
      const result = await AutomationRuntime.startPlaywright({
        headless: params.headless,
        url: params.url,
        timeoutMs: params.timeoutMs,
        waitUntil: params.wait_until,
        playwrightLauncherGlobal: params.playwright_launcher_global,
      })
      const started = "started" in result ? result.started : undefined
      return {
        title: !result.ok
          ? "Playwright runtime start failed"
          : started === false
            ? "Playwright runtime already started"
            : "Playwright runtime started",
        output: result.ok ? JSON.stringify(result) : failed(result),
        metadata: result,
      }
    }
    if (params.action === "stop") {
      const result = await AutomationRuntime.stopPlaywright()
      return {
        title: result.ok ? "Playwright runtime stopped" : "Playwright runtime stop skipped",
        output: result.ok ? JSON.stringify(result) : failed(result),
        metadata: result,
      }
    }
    if (params.action === "open") {
      const result = await AutomationRuntime.openPlaywright({
        url: params.url,
        timeoutMs: params.timeoutMs,
        waitUntil: params.wait_until,
      })
      return {
        title: result.ok ? "Playwright tab opened URL" : "Playwright open failed",
        output: result.ok ? JSON.stringify(result) : failed(result),
        metadata: result,
      }
    }
    if (params.action === "new_tab") {
      const result = await AutomationRuntime.newPlaywrightTab({
        url: params.url,
        timeoutMs: params.timeoutMs,
        waitUntil: params.wait_until,
      })
      return {
        title: result.ok ? "Playwright tab created" : "Playwright new tab failed",
        output: result.ok ? JSON.stringify(result) : failed(result),
        metadata: result,
      }
    }
    if (params.action === "switch_tab") {
      const result = await AutomationRuntime.switchPlaywrightTab({
        index: params.index,
      })
      return {
        title: result.ok ? "Playwright tab switched" : "Playwright switch tab failed",
        output: result.ok ? JSON.stringify(result) : failed(result),
        metadata: result,
      }
    }
    if (params.action === "list_tabs") {
      const result = await AutomationRuntime.listPlaywrightTabs()
      return {
        title: result.ok ? "Playwright tabs" : "Playwright runtime unavailable",
        output: result.ok ? JSON.stringify(result) : failed(result),
        metadata: result,
      }
    }
    if (params.action === "close_tab") {
      const result = await AutomationRuntime.closePlaywrightTab({
        index: params.index,
      })
      return {
        title: result.ok ? "Playwright tab closed" : "Playwright close tab failed",
        output: result.ok ? JSON.stringify(result) : failed(result),
        metadata: result,
      }
    }

    if (params.action !== "run") {
      return {
        title: "Automation action unsupported",
        output: `Unsupported action: ${String((params as { action?: string }).action ?? "")}`,
        metadata: {
          ok: false,
          reason: "unsupported_action",
        },
      }
    }

    const runtime = AutomationRuntime.status()
    if (!ready(params.driver, runtime)) {
      const message = missing(params.driver, runtime)
      return {
        title: "Automation runtime unavailable",
        output: message,
        metadata: {
          ok: false,
          reason: "runtime_unavailable",
          driver: params.driver ?? "auto",
          runtime,
        },
      }
    }

    const selected = selectDriver(
      AutomationRuntime.merge({
        kind: params.driver,
      }),
    )
    const engine = Automation.create(selected.driver, {
      timeoutMs: params.timeoutMs ?? 5000,
      intervalMs: params.intervalMs ?? 120,
      retryMax: params.retryMax ?? 2,
      backoffMs: params.backoffMs ?? [120, 320, 640],
    })
    const steps = (params.step ? [params.step] : (params.steps ?? [])).map((step: z.infer<typeof Step>) =>
      normalize(step, params.post_template),
    )
    const flow =
      steps.length === 1
        ? await engine.run(steps[0], { abort: ctx.abort }).then((step) => ({
            ok: step.ok,
            steps: [step],
          }))
        : await engine.runAll(steps, {
            abort: ctx.abort,
            stopOnFail: params.stopOnFail ?? true,
          })
    const failed = flow.steps.filter((x) => !x.ok)

    return {
      title: flow.ok ? "Automation flow completed" : "Automation flow failed",
      output: JSON.stringify({
        ok: flow.ok,
        driver: selected.kind,
        total: flow.steps.length,
        failed: failed.length,
        steps: flow.steps.map(compact),
      }),
      metadata: {
        ok: flow.ok,
        driver: selected.kind,
        total: flow.steps.length,
        failed: failed.length,
      },
    }
  },
})
