/**
 * LLM Screenshot Review — takes a screenshot of a web page and sends it
 * to a vision-capable LLM for analysis.
 *
 * Compatible with any model that supports image input (Claude, GPT-4/5, etc.).
 * Gracefully skips if the model doesn't support vision or Puppeteer is unavailable.
 */
import { generateText } from "ai"
import z from "zod"
import { resolveHeadlessLanguageModel } from "@/llm/headless"
import { Log } from "@/util/log"
import type { EvaluationOutcome, EvaluationDelivery, EvaluationTask } from "./shared"
import { emptyOptional, softOrStrict } from "./shared"
import { CheckConfig } from "@/orchestrator/model"

const log = Log.create({ service: "screenshot-review" })

const SCREENSHOT_TIMEOUT_MS = 15_000
const LLM_TIMEOUT_MS = 30_000

/**
 * Take a screenshot of a running web app and have an LLM analyze it.
 * Returns pass if the page renders meaningful content, fail if blank/broken.
 */
export async function screenshotReviewResult(
  config: z.infer<typeof CheckConfig>["ui_review"],
  task: EvaluationTask,
  delivery: EvaluationDelivery,
): Promise<EvaluationOutcome> {
  if (!config) return emptyOptional()
  const mode = softOrStrict(config)
  const url = config.url ?? "http://localhost:3000"

  // Step 1: Take screenshot with Puppeteer
  let screenshotBase64: string
  try {
    screenshotBase64 = await takeScreenshot(url)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.warn("screenshot capture failed", { url, error: msg })
    return {
      outcome: mode === "strict" ? "failed" : "skipped",
      summary: `Screenshot capture failed: ${msg}`,
      checks: [{
        name: "screenshot_review",
        status: mode === "strict" ? "failed" : "skipped",
        evidence: `Could not capture screenshot of ${url}: ${msg}`,
      }],
      artifacts: [{
        kind: "report",
        label: "evaluation:screenshot_review",
        payload: { url, error: msg, captured: false },
      }],
    }
  }

  // Step 2: Send to LLM for analysis
  try {
    const resolved = await resolveHeadlessLanguageModel({
      label: "screenshot-review",
      metadata: task.metadata,
    })

    // Check if model supports image input
    if (!resolved.model.capabilities.input?.image) {
      log.info("screenshot review skipped — model does not support image input", {
        model: `${resolved.model.providerID}/${resolved.model.id}`,
      })
      return {
        outcome: "skipped",
        summary: "Screenshot review skipped — configured model does not support image input.",
        checks: [{
          name: "screenshot_review",
          status: "skipped",
          evidence: `Model ${resolved.model.providerID}/${resolved.model.id} does not support vision.`,
        }],
        artifacts: [],
      }
    }

    const result = await generateText({
      model: resolved.language,
      maxTokens: 1024,
      abortSignal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            image: Buffer.from(screenshotBase64, "base64"),
            mimeType: "image/png",
          },
          {
            type: "text",
            text: `You are a QA engineer reviewing a web application screenshot.

Analyze this screenshot and determine:
1. Does the page render meaningful content (not a blank/white screen)?
2. Are there visible UI elements (text, buttons, navigation, data)?
3. Are there obvious visual errors (broken layout, overlapping elements, missing images)?
4. Does it look like a functional application (not a framework error page or stack trace)?

Respond with exactly one of these on the first line:
PASS — if the page renders correctly with meaningful content
FAIL — if the page is blank, shows errors, or is clearly broken

Then explain your reasoning in 2-3 sentences.`,
          },
        ],
      }],
    })

    const text = result.text.trim()
    const passed = text.startsWith("PASS")
    const evidence = text.slice(0, 500)

    log.info("screenshot review completed", {
      url,
      passed,
      model: `${resolved.model.providerID}/${resolved.model.id}`,
    })

    return {
      outcome: passed ? "passed" : (mode === "strict" ? "failed" : "skipped"),
      summary: passed ? "Screenshot review passed — page renders correctly." : `Screenshot review: ${evidence}`,
      checks: [{
        name: "screenshot_review",
        status: passed ? "passed" : (mode === "strict" ? "failed" : "skipped"),
        evidence,
      }],
      artifacts: [
        {
          kind: "report",
          label: "evaluation:screenshot_review",
          payload: { url, passed, evidence, model: `${resolved.model.providerID}/${resolved.model.id}` },
        },
        {
          kind: "image",
          label: "screenshot",
          payload: { url, base64: screenshotBase64.slice(0, 200) + "..." },
        },
      ],
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.warn("screenshot LLM review failed", { url, error: msg })
    return {
      outcome: "skipped",
      summary: `Screenshot LLM review skipped: ${msg}`,
      checks: [{
        name: "screenshot_review",
        status: "skipped",
        evidence: msg,
      }],
      artifacts: [],
    }
  }
}

/**
 * Take a PNG screenshot of a URL using Puppeteer.
 * Returns base64-encoded PNG data.
 */
async function takeScreenshot(url: string): Promise<string> {
  let puppeteer: typeof import("puppeteer-core")
  try {
    puppeteer = await import("puppeteer-core")
  } catch {
    throw new Error("Puppeteer not available — cannot take screenshots")
  }

  // Find Chrome/Chromium
  const executablePath = findChromium()
  if (!executablePath) {
    throw new Error("No Chrome/Chromium browser found for screenshots")
  }

  const browser = await puppeteer.default.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
  })

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })
    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: SCREENSHOT_TIMEOUT_MS,
    })
    // Wait a bit for JS rendering
    await new Promise((resolve) => setTimeout(resolve, 2000))
    const buffer = await page.screenshot({ type: "png", encoding: "base64" }) as string
    return buffer
  } finally {
    await browser.close()
  }
}

/**
 * Find a Chrome/Chromium executable on the system.
 */
function findChromium(): string | undefined {
  const { execSync } = require("node:child_process")
  const candidates =
    process.platform === "win32"
      ? [
          process.env.CHROME_PATH,
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
          `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env.LOCALAPPDATA}\\Chromium\\Application\\chrome.exe`,
        ]
      : process.platform === "darwin"
        ? [
            process.env.CHROME_PATH,
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
          ]
        : [
            process.env.CHROME_PATH,
            tryWhich("google-chrome"),
            tryWhich("google-chrome-stable"),
            tryWhich("chromium"),
            tryWhich("chromium-browser"),
          ]

  return candidates.filter(Boolean).find((p) => {
    try {
      require("node:fs").accessSync(p!)
      return true
    } catch {
      return false
    }
  }) as string | undefined
}

function tryWhich(name: string): string | undefined {
  try {
    return require("node:child_process").execSync(`which ${name}`, { encoding: "utf-8" }).trim() || undefined
  } catch {
    return undefined
  }
}
