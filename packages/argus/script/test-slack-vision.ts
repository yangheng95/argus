/**
 * Argus Mini-Agent: Slack Vision Test
 *
 * A standalone test harness that mirrors the real Argus agent architecture:
 *
 *   Perception (eyes)  -->  Understanding (vision)  -->  Communication (slack)
 *
 * Instead of the full Bus/Instance system, it wires up the same
 * perception -> understanding -> comm pipeline with a lightweight event emitter.
 *
 * Usage:
 *   cd packages/argus
 *   bun run script/test-slack-vision.ts
 *
 * Then send `!capture` in the configured Slack channel.
 */

import path from "path"
import fs from "fs"
import { EventEmitter } from "events"

// ── Load .env ────────────────────────────────────────────
const envPath = path.resolve(import.meta.dir, "../../../.env")
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    const key = trimmed.slice(0, eq)
    if (!process.env[key]) process.env[key] = trimmed.slice(eq + 1)
  }
}

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN
const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID
const VISION_API_KEY = process.env.BAILIAN_CODING_PLAN_API_KEY
const VISION_MODEL = process.env.ARGUS_VISION_MODEL || "qwen-vl-plus"

if (!SLACK_BOT_TOKEN || !SLACK_APP_TOKEN) {
  console.error("Missing SLACK_BOT_TOKEN or SLACK_APP_TOKEN")
  process.exit(1)
}

// ═══════════════════════════════════════════════════════════
// Agent Event Bus (lightweight stand-in for the real Bus)
// ═══════════════════════════════════════════════════════════
const bus = new EventEmitter()

// Event types that flow through the agent
type ScreenCaptureRequested = { source: string; timestamp: number }
type ScreenCaptured = { buffer: Buffer; path: string; width: number; height: number; timestamp: number }
type VisionAnalyzed = { summary: string; screenshotPath: string; analysis: string; timestamp: number }

// ═══════════════════════════════════════════════════════════
// Layer 1: PERCEPTION (eyes) — captures what the agent sees
// ═══════════════════════════════════════════════════════════
bus.on("screen.capture.requested", async (_event: ScreenCaptureRequested) => {
  console.log("[eyes] Opening eyes...")
  try {
    const { Monitor } = await import("node-screenshots")
    const monitors = Monitor.all()
    if (monitors.length === 0) throw new Error("No monitors found")

    const primary = monitors[0]
    const image = primary.captureImageSync()
    const buffer = Buffer.from(image.toPngSync())

    // Save to temp file (the agent's visual memory)
    const tempPath = path.join(import.meta.dir, `../capture_${Date.now()}.png`)
    fs.writeFileSync(tempPath, buffer)

    console.log(`[eyes] Captured: ${image.width}x${image.height}, ${buffer.length} bytes`)

    bus.emit("screen.captured", {
      buffer,
      path: tempPath,
      width: image.width,
      height: image.height,
      timestamp: Date.now(),
    } satisfies ScreenCaptured)
  } catch (e) {
    console.error(`[eyes] Capture failed: ${e instanceof Error ? e.message : e}`)
  }
})

// ═══════════════════════════════════════════════════════════
// Layer 2: UNDERSTANDING (vision) — makes sense of what was seen
// ═══════════════════════════════════════════════════════════
bus.on("screen.captured", async (event: ScreenCaptured) => {
  console.log("[vision] Analyzing what I see...")

  let analysisText: string
  try {
    if (!VISION_API_KEY) throw new Error("No vision API key")

    const { generateText } = await import("ai")
    const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible")

    const provider = createOpenAICompatible({
      name: "qwen",
      baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKey: VISION_API_KEY,
    })

    const result = await generateText({
      model: provider.chatModel(VISION_MODEL),
      messages: [
        {
          role: "user",
          content: [
            { type: "image", image: event.buffer },
            {
              type: "text",
              text: [
                "You are Argus, an autonomous development monitoring agent.",
                "Analyze this screenshot of a developer's screen.",
                "Return a JSON object with:",
                '  "screenState": one of idle|running|error|waiting_input|permission_required|complete|stuck|loading',
                '  "summary": what you see on screen',
                '  "confidence": 0.0-1.0',
                '  "errorDetails": if any error is visible',
                '  "suggestedAction": if action is needed',
              ].join("\n"),
            },
          ],
        },
      ],
    })
    analysisText = result.text
    console.log(`[vision] Understanding: ${analysisText.slice(0, 150)}...`)
  } catch (e) {
    analysisText = JSON.stringify({
      screenState: "unknown",
      summary: `Vision unavailable: ${e instanceof Error ? e.message : e}`,
      confidence: 0,
    })
    console.log(`[vision] Falling back: ${e instanceof Error ? e.message : e}`)
  }

  bus.emit("vision.analyzed", {
    summary: analysisText,
    screenshotPath: event.path,
    analysis: analysisText,
    timestamp: Date.now(),
  } satisfies VisionAnalyzed)
})

// ═══════════════════════════════════════════════════════════
// Layer 3: COMMUNICATION (mouth) — reports findings
// ═══════════════════════════════════════════════════════════
let slackApp: any

bus.on("vision.analyzed", async (event: VisionAnalyzed) => {
  console.log("[comm] Reporting findings to Slack...")
  const channelId = SLACK_CHANNEL_ID
  if (!channelId || !slackApp) {
    console.warn("[comm] No channel configured, dropping report")
    return
  }

  try {
    const buffer = fs.readFileSync(event.screenshotPath)
    await slackApp.client.files.uploadV2({
      channel_id: channelId,
      file: buffer,
      filename: `argus_${Date.now()}.png`,
      title: "Argus — What I See",
      initial_comment: `*Argus Vision Analysis:*\n\`\`\`\n${event.analysis}\n\`\`\``,
    })
    console.log("[comm] Screenshot + analysis sent")
  } catch (e) {
    console.error(`[comm] Upload failed: ${e instanceof Error ? e.message : e}`)
    // Fall back to text-only
    try {
      await slackApp.client.chat.postMessage({
        channel: channelId,
        text: `*Argus Analysis (no screenshot):*\n\`\`\`\n${event.analysis}\n\`\`\``,
      })
    } catch {}
  }

  // Cleanup temp screenshot
  try { fs.unlinkSync(event.screenshotPath) } catch {}
})

// ═══════════════════════════════════════════════════════════
// Ears: Slack message listener — the agent's "hearing"
// ═══════════════════════════════════════════════════════════
const { App } = await import("@slack/bolt")

slackApp = new App({
  token: SLACK_BOT_TOKEN,
  signingSecret: "not-used-in-socket-mode",
  socketMode: true,
  appToken: SLACK_APP_TOKEN,
})

slackApp.message(async ({ message, say }: any) => {
  if (message.subtype) return
  const text = message.text?.trim()
  if (!text) return

  console.log(`[ears] Heard: "${text}"`)

  if (text === "!capture" || text === "!screenshot") {
    // The agent heard a request to look — trigger perception
    await say("Looking...")
    bus.emit("screen.capture.requested", {
      source: "slack",
      timestamp: Date.now(),
    } satisfies ScreenCaptureRequested)
  } else if (text === "!ping") {
    await say("pong!")
  } else if (text === "!help") {
    await say(
      [
        "*Argus Mini-Agent Commands:*",
        "`!capture` / `!screenshot` — I look at the screen, understand it, and report back",
        "`!ping` — Check if I'm alive",
        "`!help` — Show this message",
      ].join("\n"),
    )
  }
})

// ═══════════════════════════════════════════════════════════
// Boot
// ═══════════════════════════════════════════════════════════
await slackApp.start()
console.log()
console.log("=== Argus Mini-Agent Started ===")
console.log()
console.log("  Architecture: ears (slack) -> perception (capture) -> understanding (vision) -> comm (slack)")
console.log(`  Vision model: ${VISION_MODEL}`)
console.log(`  Channel: ${SLACK_CHANNEL_ID}`)
console.log()
console.log('  Send "!capture" in Slack to trigger the perception -> understanding -> comm pipeline.')
console.log("  Press Ctrl+C to stop.")
console.log()
