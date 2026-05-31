import fs from "node:fs/promises"
import path from "node:path"
import type { Browser } from "playwright"
import type { AcceptanceSpec } from "@/acceptance/types"
import { BrowserRuntime } from "@/browser/runtime"
import { executeWalkthrough, type WalkthroughExecutionResult, type WalkthroughPage } from "./dsl"
import { translateScenarioToSteps } from "./translate"

export type WalkthroughResult = WalkthroughExecutionResult & {
  specId: string
  scenarioTitle: string
  screenshotPath?: string
  evidence: string[]
}

type BrowserRuntimeLike = {
  launch: (input: {
    headless: true
    args: string[]
  }) => Promise<Browser>
}

export type RunWalkthroughDependencies = {
  translate: typeof translateScenarioToSteps
  browserRuntime: BrowserRuntimeLike
}

const defaultDependencies: RunWalkthroughDependencies = {
  translate: translateScenarioToSteps,
  browserRuntime: {
    launch: (input) => BrowserRuntime.launchPlaywrightBrowser(input),
  },
}

export async function runWalkthrough(input: {
  spec: AcceptanceSpec
  baseUrl: string
  outDir: string
  taskID?: string
  sessionID?: string
}): Promise<WalkthroughResult> {
  return runWalkthroughWithDependencies(input, defaultDependencies)
}

export async function runWalkthroughWithDependencies(
  input: { spec: AcceptanceSpec; baseUrl: string; outDir: string; taskID?: string; sessionID?: string },
  dependencies: RunWalkthroughDependencies,
): Promise<WalkthroughResult> {
  const steps = await dependencies.translate({ spec: input.spec, taskID: input.taskID, sessionID: input.sessionID })
  await fs.mkdir(input.outDir, { recursive: true })
  const browser = await dependencies.browserRuntime.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  })
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    const execution = await executeWalkthrough({ page: page as unknown as WalkthroughPage, baseUrl: input.baseUrl, steps })
    const screenshotPath = path.join(input.outDir, `${sanitize(input.spec.id)}.png`)
    await page.screenshot({ path: screenshotPath, type: "png" })
    return {
      ...execution,
      specId: input.spec.id,
      scenarioTitle: input.spec.title,
      screenshotPath,
      evidence: [
        `scenario_id=${input.spec.id}`,
        `steps=${steps.length}`,
        `passed=${execution.passed}`,
        `final_path=${execution.finalPath}`,
        execution.firstFailure ? `first_failure=${execution.firstFailure.index}:${execution.firstFailure.message}` : undefined,
        execution.pageErrors.length > 0 ? `page_errors=${execution.pageErrors.join("; ")}` : undefined,
        execution.consoleErrors.length > 0 ? `console_errors=${execution.consoleErrors.join("; ")}` : undefined,
      ].filter((item): item is string => Boolean(item)),
    }
  } finally {
    await browser.close()
  }
}

function sanitize(input: string): string {
  return input.replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 80) || "scenario"
}
