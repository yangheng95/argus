import fs from "node:fs/promises"
import path from "node:path"
import type { AcceptanceSpec } from "@/acceptance/types"
import { BrowserRuntime } from "@/browser/runtime"
import { runBrowserNodeSidecar } from "@/browser/runtime/node-executor"
import { resolveBrowserNodeSidecarRuntime } from "@/browser/runtime/node-sidecar"
import { executeWalkthrough, type WalkthroughExecutionResult, type WalkthroughPage, type WalkthroughStep } from "./dsl"
import { translateScenarioToSteps } from "./translate"

type Browser = any

export type WalkthroughResult = WalkthroughExecutionResult & {
  specId: string
  scenarioTitle: string
  screenshotPath?: string
  evidence: string[]
}

type BrowserRuntimeLike = {
  launch: (input: { headless: true; args: string[] }) => Promise<Browser>
}

export type RunWalkthroughDependencies = {
  translate: typeof translateScenarioToSteps
  browserRuntime: BrowserRuntimeLike
}

export async function runWalkthrough(input: {
  spec: AcceptanceSpec
  baseUrl: string
  outDir: string
  taskID?: string
  sessionID?: string
}): Promise<WalkthroughResult> {
  const steps = await translateScenarioToSteps({ spec: input.spec, taskID: input.taskID, sessionID: input.sessionID })
  return runWalkthroughViaNode({ ...input, steps })
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
    const execution = await executeWalkthrough({
      page: page as unknown as WalkthroughPage,
      baseUrl: input.baseUrl,
      steps,
    })
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
        execution.firstFailure
          ? `first_failure=${execution.firstFailure.index}:${execution.firstFailure.message}`
          : undefined,
        execution.pageErrors.length > 0 ? `page_errors=${execution.pageErrors.join("; ")}` : undefined,
        execution.consoleErrors.length > 0 ? `console_errors=${execution.consoleErrors.join("; ")}` : undefined,
      ].filter((item): item is string => Boolean(item)),
    }
  } finally {
    await browser.close()
  }
}

async function runWalkthroughViaNode(input: {
  spec: AcceptanceSpec
  baseUrl: string
  outDir: string
  steps: WalkthroughStep[]
}): Promise<WalkthroughResult> {
  await fs.mkdir(input.outDir, { recursive: true })
  const screenshotPath = path.join(input.outDir, `${sanitize(input.spec.id)}.png`)
  const executablePath = await BrowserRuntime.findBrowserExecutable()
  const launchTimeoutMs = BrowserRuntime.resolveBrowserLaunchTimeoutMs()
  const runtime = await resolveBrowserNodeSidecarRuntime()
  const run = await runBrowserNodeSidecar<
    { ok: true; execution: WalkthroughExecutionResult } | { ok: false; message: string; stack?: string }
  >({
    runtime,
    script: NODE_WALKTHROUGH_SCRIPT,
    payload: {
      baseUrl: input.baseUrl,
      steps: input.steps,
      screenshotPath,
      executablePath,
      launchTimeoutMs,
    },
    payloadEnvName: "OPENCORVUS_WALKTHROUGH_INPUT",
    hardTimeoutMs: launchTimeoutMs + 120_000,
    label: "Node walkthrough",
  })
  const result = run.result
  if (!result.ok) {
    throw new Error(`walkthrough Node sidecar failed: ${result.message}${result.stack ? `\n${result.stack}` : ""}`)
  }
  return {
    ...result.execution,
    specId: input.spec.id,
    scenarioTitle: input.spec.title,
    screenshotPath,
    evidence: [
      `scenario_id=${input.spec.id}`,
      `steps=${input.steps.length}`,
      `passed=${result.execution.passed}`,
      `final_path=${result.execution.finalPath}`,
      result.execution.firstFailure
        ? `first_failure=${result.execution.firstFailure.index}:${result.execution.firstFailure.message}`
        : undefined,
      result.execution.pageErrors.length > 0 ? `page_errors=${result.execution.pageErrors.join("; ")}` : undefined,
      result.execution.consoleErrors.length > 0
        ? `console_errors=${result.execution.consoleErrors.join("; ")}`
        : undefined,
    ].filter((item): item is string => Boolean(item)),
  }
}

const NODE_WALKTHROUGH_SCRIPT = String.raw`
const { chromium } = require(process.env.OPENCORVUS_PLAYWRIGHT_REQUIRE_PATH || "playwright");

function isResourceLoadConsoleError(text) {
  return String(text || "").trimStart().startsWith("Failed to load resource:");
}

function finalPath(page) {
  try {
    return new URL(page.url()).pathname;
  } catch {
    return page.url();
  }
}

async function executeStep(page, baseUrl, step) {
  if (step.action === "goto") {
    await page.goto(new URL(step.path, baseUrl).toString(), { waitUntil: "networkidle" });
    return;
  }
  if (step.action === "fill") {
    await page.click(step.selector);
    await page.keyboard.down("Control");
    await page.keyboard.press("A");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await page.type(step.selector, step.value);
    return;
  }
  if (step.action === "click") {
    const navigation = page.waitForNavigation({ timeout: 5_000, waitUntil: "load" }).catch(() => undefined);
    await page.click(step.selector);
    await navigation;
    return;
  }
  if (step.action === "assertPath") {
    const actual = new URL(page.url()).pathname;
    if (!actual.includes(step.path)) throw new Error("expected path containing " + step.path + ", got " + actual);
    return;
  }
  if (step.action === "assertSelector") {
    const found = Boolean(await page.$(step.selector));
    const present = step.present ?? true;
    if (present && !found) throw new Error("expected selector " + step.selector);
    if (!present && found) throw new Error("expected selector " + step.selector + " to be absent");
    return;
  }
  if (step.action === "assertText") {
    const found = await page.evaluate((text) => document.body?.textContent?.includes(text) ?? false, step.text);
    if (!found) throw new Error("expected text " + step.text);
    return;
  }
  throw new Error("unsupported walkthrough action: " + step.action);
}

async function main() {
  const input = JSON.parse(Buffer.from(process.env.OPENCORVUS_WALKTHROUGH_INPUT || "", "base64").toString("utf8"));
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: input.executablePath,
      headless: true,
      timeout: input.launchTimeoutMs,
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error instanceof Error ? error.message : String(error)));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      if (isResourceLoadConsoleError(text)) return;
      consoleErrors.push(text);
    });
    for (const [index, step] of input.steps.entries()) {
      try {
        await executeStep(page, input.baseUrl, step);
      } catch (error) {
        await page.screenshot({ path: input.screenshotPath, type: "png" }).catch(() => undefined);
        process.stdout.write(JSON.stringify({
          ok: true,
          execution: {
            passed: false,
            steps: input.steps,
            finalPath: finalPath(page),
            pageErrors,
            consoleErrors,
            firstFailure: { index, step, message: error instanceof Error ? error.message : String(error) },
          },
        }));
        return;
      }
    }
    await page.screenshot({ path: input.screenshotPath, type: "png" });
    process.stdout.write(JSON.stringify({
      ok: true,
      execution: {
        passed: pageErrors.length === 0 && consoleErrors.length === 0,
        steps: input.steps,
        finalPath: finalPath(page),
        pageErrors,
        consoleErrors,
      },
    }));
  } catch (error) {
    process.stdout.write(JSON.stringify({
      ok: false,
      message: error && error.message ? error.message : String(error),
      stack: error && error.stack ? error.stack : undefined,
    }));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}

main();
`

function sanitize(input: string): string {
  return input.replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 80) || "scenario"
}
