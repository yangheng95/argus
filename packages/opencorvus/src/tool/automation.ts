import z from "zod"
import { Tool } from "./tool"
import { Automation, AutomationRuntime, selectDriver } from "../opencorvus/automation"

const DESCRIPTION = `Run selector-based GUI automation flows with retry and recovery.

Use this tool for Playwright (web) or Appium (mobile) sessions that are already attached in the current process.

Actions:
- status: Show whether Playwright/Appium runtime context is attached.
- run: Execute one step or a flow of steps with locate/pre/act/post checks.

Driver:
- auto (default): prefers Playwright, then Appium.
- playwright: require Playwright runtime.
- appium: require Appium runtime.`

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

const Step = z.object({
  id: z.string().min(1),
  target: z.array(Locator).min(1).optional(),
  pre: z.array(Check).optional(),
  act: Action,
  post: z.array(Check).optional(),
  timeoutMs: z.number().int().min(1).max(120000).optional(),
  intervalMs: z.number().int().min(0).max(10000).optional(),
  retry: Retry.optional(),
})

const Driver = z.enum(["auto", "playwright", "appium"]).optional()

const Run = z.object({
  action: z.literal("run"),
  driver: Driver.describe("auto (default), playwright, or appium"),
  step: Step.optional(),
  steps: z.array(Step).min(1).optional(),
  stopOnFail: z.boolean().optional(),
  timeoutMs: z.number().int().min(1).max(120000).optional(),
  intervalMs: z.number().int().min(0).max(10000).optional(),
  retryMax: z.number().int().min(1).max(10).optional(),
  backoffMs: z.array(z.number().int().min(0)).optional(),
}).refine((x) => !!x.step || !!x.steps, { message: "Provide either step or steps." })
  .refine((x) => !(x.step && x.steps), { message: "Use step or steps, not both." })

const Params = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("status"),
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

    const selected = selectDriver(AutomationRuntime.merge({
      kind: params.driver,
    }))
    const engine = Automation.create(selected.driver, {
      timeoutMs: params.timeoutMs ?? 5000,
      intervalMs: params.intervalMs ?? 120,
      retryMax: params.retryMax ?? 2,
      backoffMs: params.backoffMs ?? [120, 320, 640],
    })
    const steps = params.step ? [params.step] : params.steps ?? []
    const flow = steps.length === 1
      ? await engine.run(steps[0], { abort: ctx.abort })
        .then((step) => ({
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
