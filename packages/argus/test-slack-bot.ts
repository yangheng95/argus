/**
 * Minimal Slack bot for testing the Slack → Claude Code flow.
 *
 * Usage: bun run test-slack-bot.ts
 *
 * Listens for messages in the configured Slack channel,
 * acknowledges them, and can forward tasks.
 */
import { App } from "@slack/bolt"

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN
const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID

if (!SLACK_BOT_TOKEN || !SLACK_APP_TOKEN) {
  console.error("Missing SLACK_BOT_TOKEN or SLACK_APP_TOKEN in .env")
  process.exit(1)
}

const app = new App({
  token: SLACK_BOT_TOKEN,
  signingSecret: "not-used-in-socket-mode",
  socketMode: true,
  appToken: SLACK_APP_TOKEN,
})

console.log("🔧 Slack Bot Configuration:")
console.log(`  Channel: ${SLACK_CHANNEL_ID}`)
console.log(`  Bot token: ${SLACK_BOT_TOKEN?.slice(0, 10)}...`)
console.log()

app.message(async ({ message, say }) => {
  if (message.subtype) return
  if (!("text" in message) || !message.text) return

  const text = message.text.trim()
  const userId = (message as any).user
  console.log(`📨 [${userId}] ${text}`)

  // Acknowledge the message
  await say({
    text: `✅ Task received! Starting Claude Code to work on:\n> ${text.slice(0, 300)}`,
    thread_ts: (message as any).thread_ts || message.ts,
  })

  // Here we would start Claude Code - for now just log it
  console.log(`🚀 Would start Claude Code with task: ${text.slice(0, 100)}`)
})

await app.start()
console.log("⚡ Slack bot is running! Waiting for messages...")
console.log("   Press Ctrl+C to stop.")
console.log()
