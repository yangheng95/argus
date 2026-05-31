import z from "zod"
import { isResourceLoadConsoleError } from "../browser-noise"

export const WalkthroughStepSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("goto"), path: z.string().min(1) }),
  z.object({ action: z.literal("fill"), selector: z.string().min(1), value: z.string() }),
  z.object({ action: z.literal("click"), selector: z.string().min(1) }),
  z.object({ action: z.literal("assertPath"), path: z.string().min(1) }),
  z.object({ action: z.literal("assertSelector"), selector: z.string().min(1), present: z.boolean().optional() }),
  z.object({ action: z.literal("assertText"), text: z.string().min(1) }),
])
export const WalkthroughStepsSchema = z.array(WalkthroughStepSchema).min(1)
export type WalkthroughStep = z.infer<typeof WalkthroughStepSchema>

export type WalkthroughPage = {
  goto: (url: string, options?: Record<string, unknown>) => Promise<unknown>
  waitForNavigation: (options?: Record<string, unknown>) => Promise<unknown>
  type: (selector: string, value: string) => Promise<unknown>
  click: (selector: string) => Promise<unknown>
  keyboard: {
    down: (key: string) => Promise<unknown>
    up: (key: string) => Promise<unknown>
    press: (key: string) => Promise<unknown>
  }
  $: (selector: string) => Promise<unknown>
  evaluate: <R, Arg = unknown>(fn: ((arg: Arg) => R) | string, arg?: Arg) => Promise<R>
  url: () => string
  on?: (event: string, handler: (...args: unknown[]) => void) => unknown
}

export type WalkthroughExecutionResult = {
  passed: boolean
  steps: WalkthroughStep[]
  finalPath: string
  pageErrors: string[]
  consoleErrors: string[]
  firstFailure?: { index: number; step: WalkthroughStep; message: string }
}

type StepHandler = (input: { page: WalkthroughPage; baseUrl: string; step: WalkthroughStep }) => Promise<void>
const NAVIGATION_WAIT_MS = 5_000

const stepHandlers: { [K in WalkthroughStep["action"]]: StepHandler } = {
  goto: async ({ page, baseUrl, step }) => {
    if (step.action === "goto") await page.goto(new URL(step.path, baseUrl).toString(), { waitUntil: "networkidle" })
  },
  fill: async ({ page, step }) => {
    if (step.action !== "fill") return
    await page.click(step.selector)
    await page.keyboard.down("Control")
    await page.keyboard.press("A")
    await page.keyboard.up("Control")
    await page.keyboard.press("Backspace")
    await page.type(step.selector, step.value)
  },
  click: async ({ page, step }) => {
    if (step.action !== "click") return
    const navigation = page.waitForNavigation({ timeout: NAVIGATION_WAIT_MS, waitUntil: "load" }).catch(() => undefined)
    await page.click(step.selector)
    await navigation
  },
  assertPath: async ({ page, step }) => {
    if (step.action !== "assertPath") return
    const actual = new URL(page.url()).pathname
    if (!actual.includes(step.path)) throw new Error(`expected path containing ${step.path}, got ${actual}`)
  },
  assertSelector: async ({ page, step }) => {
    if (step.action !== "assertSelector") return
    const found = Boolean(await page.$(step.selector))
    const present = step.present ?? true
    if (present && !found) throw new Error(`expected selector ${step.selector}`)
    if (!present && found) throw new Error(`expected selector ${step.selector} to be absent`)
  },
  assertText: async ({ page, step }) => {
    if (step.action !== "assertText") return
    const found = await page.evaluate((text: string) => document.body?.textContent?.includes(text) ?? false, step.text)
    if (!found) throw new Error(`expected text ${step.text}`)
  },
}

export async function executeWalkthrough(input: {
  page: WalkthroughPage
  baseUrl: string
  steps: WalkthroughStep[]
}): Promise<WalkthroughExecutionResult> {
  const steps = WalkthroughStepsSchema.parse(input.steps)
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  input.page.on?.("pageerror", (error) => pageErrors.push(error instanceof Error ? error.message : String(error)))
  input.page.on?.("console", (message) => {
    const item = message as { type?: () => string; text?: () => string }
    if (item.type?.() !== "error") return
    const text = item.text?.() ?? String(message)
    // Browser-mirrored network-load failures are not walkthrough JS faults
    // (single-sourced in the asset layer; same rationale as runtime capture).
    if (isResourceLoadConsoleError(text)) return
    consoleErrors.push(text)
  })
  for (const [index, step] of steps.entries()) {
    try {
      await stepHandlers[step.action]({ page: input.page, baseUrl: input.baseUrl, step })
    } catch (error) {
      return {
        passed: false,
        steps,
        finalPath: finalPath(input.page),
        pageErrors,
        consoleErrors,
        firstFailure: { index, step, message: error instanceof Error ? error.message : String(error) },
      }
    }
  }
  return {
    passed: pageErrors.length === 0 && consoleErrors.length === 0,
    steps,
    finalPath: finalPath(input.page),
    pageErrors,
    consoleErrors,
  }
}

function finalPath(page: WalkthroughPage) {
  try {
    return new URL(page.url()).pathname
  } catch {
    return page.url()
  }
}
