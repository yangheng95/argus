import fs from "node:fs/promises"
import path from "node:path"
import puppeteer from "puppeteer-core"
import type { AcceptanceSpec } from "@/acceptance/types"
import { findBrowserExecutable } from "../visual"
import { executeWalkthrough, type WalkthroughExecutionResult, type WalkthroughPage } from "./dsl"
import { translateScenarioToSteps } from "./translate"

export type WalkthroughResult = WalkthroughExecutionResult & {
  specId: string
  scenarioTitle: string
  screenshotPath?: string
  evidence: string[]
}

type PuppeteerLike = {
  launch: (input: {
    executablePath: string
    headless: true
    args: string[]
    defaultViewport: { width: number; height: number }
  }) => Promise<{
    newPage: () => Promise<WalkthroughPage & { screenshot: (input: { path: string; type: "png" }) => Promise<unknown> }>
    close: () => Promise<unknown>
  }>
}

export type RunWalkthroughDependencies = {
  translate: typeof translateScenarioToSteps
  findBrowserExecutable: typeof findBrowserExecutable
  puppeteer: PuppeteerLike
}

const defaultDependencies: RunWalkthroughDependencies = {
  translate: translateScenarioToSteps,
  findBrowserExecutable,
  puppeteer: puppeteer as unknown as PuppeteerLike,
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
  const browser = await dependencies.puppeteer.launch({
    executablePath: await dependencies.findBrowserExecutable(),
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    defaultViewport: { width: 1440, height: 900 },
  })
  try {
    const page = await browser.newPage()
    const execution = await executeWalkthrough({ page, baseUrl: input.baseUrl, steps })
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
