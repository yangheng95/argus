/**
 * Browser-based checks: visual validation, Puppeteer automation, and web page fetching.
 */

import z from "zod"
import puppeteer from "puppeteer-core"
import { CheckConfig } from "@/orchestrator/model"
import { Filesystem } from "@/util/filesystem"
import { which } from "@/util/which"
import * as Outcome from "./outcome"
import { clip } from "./types"

// ---------------------------------------------------------------------------
// Web page fetching
// ---------------------------------------------------------------------------

export async function webPage(url: string, timeoutMs: number) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const response = await fetch(url, {
    signal: ctrl.signal,
    headers: {
      "user-agent": "OpenCorvus evaluator",
    },
  }).catch(() => undefined)
  clearTimeout(timer)
  if (!response?.ok) return
  const content = await response.text().catch(() => "")
  return {
    content,
    title: titleOf(content),
  }
}

export function titleOf(html: string) {
  const match = html.match(/<title[^>]*>(.*?)<\/title>/is)
  if (!match?.[1]) return ""
  return match[1].replace(/\s+/g, " ").trim()
}

export function stripHtml(input: string) {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

// ---------------------------------------------------------------------------
// Visual check
// ---------------------------------------------------------------------------

export async function visualResult(config: z.infer<typeof CheckConfig>["visual"]) {
  if (!config) return Outcome.empty()
  const mode = config.mode ?? "soft"
  const page = await webPage(config.url, config.timeout_ms ?? 10_000)
  if (!page) {
    if (mode === "strict") {
      return {
        outcome: "failed" as const,
        summary: `Web visual check failed to load ${config.url}.`,
        checks: [
          {
            name: "visual",
            status: "failed" as const,
            evidence: `Could not load ${config.url}`,
          },
        ],
        artifacts: [
          {
            kind: "report" as const,
            label: "evaluation:visual",
            payload: {
              target: config.url,
              mode,
              loaded: false,
            },
          },
        ],
      }
    }
    return {
      outcome: "skipped" as const,
      summary: "Web visual check skipped because the page could not be loaded.",
      checks: [
        {
          name: "visual",
          status: "skipped" as const,
          evidence: `Could not load ${config.url}`,
        },
      ],
      artifacts: [
        {
          kind: "report" as const,
          label: "evaluation:visual",
          payload: {
            target: config.url,
            mode,
            loaded: false,
          },
        },
      ],
    }
  }

  const unmet = [
    config.require_title && !page.title.toLowerCase().includes(config.require_title.toLowerCase())
      ? `missing title: ${config.require_title}`
      : undefined,
    ...(config.require_text ?? []).map((item) =>
      page.content.toLowerCase().includes(item.toLowerCase()) ? undefined : `missing text: ${item}`,
    ),
  ].filter((item): item is string => Boolean(item))

  if (unmet.length === 0) {
    return {
      outcome: "passed" as const,
      summary: "Web visual checks passed.",
      checks: [
        {
          name: "visual",
          status: "passed" as const,
          evidence: page.title || config.url,
        },
      ],
      artifacts: [
        {
          kind: "report" as const,
          label: "evaluation:visual",
          payload: {
            target: config.url,
            title: page.title,
          },
        },
      ],
    }
  }

  return Outcome.softOrStrict({
    mode,
    name: "visual",
    summary: mode === "strict" ? `Web visual checks failed: ${unmet.join(", ")}.` : "Web visual checks skipped in soft mode.",
    evidence: unmet.join(", "),
    payload: { target: config.url, title: page.title, unmet, mode },
  })
}

// ---------------------------------------------------------------------------
// Puppeteer check
// ---------------------------------------------------------------------------

export async function puppeteerResult(config: z.infer<typeof CheckConfig>["puppeteer"]) {
  if (!config) return Outcome.empty()
  const mode = config.mode ?? "soft"
  const executable = await resolvePuppeteerExecutable(config)
  if (!executable) {
    return Outcome.softOrStrict({
      mode,
      name: "puppeteer",
      summary: "Puppeteer acceptance could not find a browser executable.",
      evidence: "No Chrome/Chromium/Edge executable was detected.",
      payload: {
        target: config.url,
        browser: config.browser,
        available: false,
        mode,
      },
    })
  }

  const browser = await puppeteer.launch({
    executablePath: executable,
    headless: true,
    defaultViewport: {
      width: config.viewport?.width ?? 1440,
      height: config.viewport?.height ?? 900,
    },
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  }).catch(() => undefined)

  if (!browser) {
    return Outcome.softOrStrict({
      mode,
      name: "puppeteer",
      summary: "Puppeteer acceptance failed to launch the browser.",
      evidence: `Failed to launch ${executable}.`,
      payload: {
        target: config.url,
        executable,
        available: false,
        mode,
      },
    })
  }

  try {
    const page = await browser.newPage()
    await page.goto(config.url, {
      waitUntil: "domcontentloaded",
      timeout: config.timeout_ms ?? 20_000,
    })
    if (config.wait_for_selector) {
      await page.waitForSelector(config.wait_for_selector, { timeout: config.timeout_ms ?? 20_000 })
    }
    if (config.wait_for_text) {
      await page.waitForFunction(
        (text) => document.body?.innerText?.includes(text),
        { timeout: config.timeout_ms ?? 20_000 },
        config.wait_for_text,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 500))

    const title = await page.title().catch(() => "")
    const content = await page.content().catch(() => "")
    const screenshot = await page.screenshot({
      type: "png",
      encoding: "base64",
      fullPage: config.full_page ?? true,
    })

    const unmet = [
      config.require_title && !title.toLowerCase().includes(config.require_title.toLowerCase())
        ? `missing title: ${config.require_title}`
        : undefined,
      ...(config.require_text ?? []).map((item) =>
        content.toLowerCase().includes(item.toLowerCase()) ? undefined : `missing text: ${item}`,
      ),
    ].filter((item): item is string => Boolean(item))

    const artifacts = [
      {
        kind: "image" as const,
        label: "evaluation:puppeteer:screenshot",
        payload: {
          target: config.url,
          title,
          browser: config.browser ?? "auto",
          executable,
          data_url: `data:image/png;base64,${screenshot}`,
        },
      },
      {
        kind: "report" as const,
        label: "evaluation:puppeteer",
        payload: {
          target: config.url,
          title,
          browser: config.browser ?? "auto",
          executable,
          wait_for_selector: config.wait_for_selector,
          wait_for_text: config.wait_for_text,
          unmet,
          mode,
        },
      },
    ]

    if (unmet.length === 0) {
      return {
        outcome: "passed" as const,
        summary: "Puppeteer browser acceptance passed.",
        checks: [
          {
            name: "puppeteer",
            status: "passed" as const,
            evidence: title || config.url,
          },
        ],
        artifacts,
      }
    }

    if (mode === "strict") {
      return {
        outcome: "failed" as const,
        summary: `Puppeteer browser acceptance failed: ${unmet.join(", ")}.`,
        checks: [
          {
            name: "puppeteer",
            status: "failed" as const,
            evidence: unmet.join(", "),
          },
        ],
        artifacts,
      }
    }

    return {
      outcome: "skipped" as const,
      summary: "Puppeteer browser acceptance skipped in soft mode.",
      checks: [
        {
          name: "puppeteer",
          status: "skipped" as const,
          evidence: unmet.join(", "),
        },
      ],
      artifacts,
    }
  } catch (error) {
    return Outcome.softOrStrict({
      mode,
      name: "puppeteer",
      summary: "Puppeteer browser acceptance failed to capture the page.",
      evidence: error instanceof Error ? error.message : String(error),
      payload: {
        target: config.url,
        executable,
        browser: config.browser ?? "auto",
        mode,
      },
    })
  } finally {
    await browser.close().catch(() => undefined)
  }
}

// ---------------------------------------------------------------------------
// Browser executable resolution
// ---------------------------------------------------------------------------

async function resolvePuppeteerExecutable(config: z.infer<typeof CheckConfig>["puppeteer"]) {
  const explicit = [config?.executable_path, process.env.OPENCORVUS_PUPPETEER_EXECUTABLE_PATH]
    .filter((item): item is string => Boolean(item?.trim()))
    .map((item) => item.trim())
  for (const item of explicit) {
    if (await Filesystem.exists(item)) return item
  }

  const names =
    process.platform === "win32"
      ? []
      : config?.browser === "edge"
        ? ["microsoft-edge", "msedge"]
        : config?.browser === "chromium"
          ? ["chromium", "chromium-browser"]
          : ["google-chrome-stable", "google-chrome", "chromium", "chromium-browser", "microsoft-edge", "msedge"]

  for (const name of names) {
    const found = which(name)
    if (found) return found
  }

  const absolute =
    process.platform === "win32"
      ? windowsBrowserCandidates(config?.browser)
      : process.platform === "darwin"
        ? macBrowserCandidates(config?.browser)
        : []
  for (const item of absolute) {
    if (await Filesystem.exists(item)) return item
  }

  return undefined
}

function windowsBrowserCandidates(browser?: "chrome" | "edge" | "chromium") {
  const chrome = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ]
  const edge = [
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ]
  const chromium = [
    "C:\\Program Files\\Chromium\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Chromium\\Application\\chrome.exe",
  ]
  if (browser === "chrome") return chrome
  if (browser === "edge") return edge
  if (browser === "chromium") return chromium
  return [...chrome, ...edge, ...chromium]
}

function macBrowserCandidates(browser?: "chrome" | "edge" | "chromium") {
  const chrome = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  const edge = ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
  const chromium = ["/Applications/Chromium.app/Contents/MacOS/Chromium"]
  if (browser === "chrome") return chrome
  if (browser === "edge") return edge
  if (browser === "chromium") return chromium
  return [...chrome, ...edge, ...chromium]
}
