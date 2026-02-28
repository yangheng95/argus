/**
 * Argus Integration Bot — Full pipeline: Slack → Claude Code CLI → Slack
 */
import { App } from "@slack/bolt"
import { spawn } from "node:child_process"
import path from "node:path"

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN!
const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN!
const ALLOWED_USERS = (() => {
  const raw = process.env.SLACK_ALLOWED_USER_IDS ?? ""
  try { return JSON.parse(raw) as string[] } catch {}
  return raw.replace(/[\[\]"]/g, "").split(",").map(s => s.trim()).filter(Boolean)
})()
const PROJECT_DIR = process.env.ARGUS_PROJECT_DIR ?? path.resolve(import.meta.dirname, "../../..")

if (!SLACK_BOT_TOKEN || !SLACK_APP_TOKEN) {
  console.error("Missing SLACK_BOT_TOKEN or SLACK_APP_TOKEN")
  process.exit(1)
}

const app = new App({
  token: SLACK_BOT_TOKEN,
  signingSecret: "not-used-in-socket-mode",
  socketMode: true,
  appToken: SLACK_APP_TOKEN,
})

const activeSessions = new Set<string>()
const seenMessages = new Set<string>()

async function postReply(channel: string, thread: string, text: string) {
  const truncated = text.length > 3900 ? text.slice(0, 3900) + "\n...(truncated)" : text
  await app.client.chat.postMessage({ channel, thread_ts: thread, text: truncated })
}

function cleanEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>
  // Remove nested-session detection vars
  delete env.CLAUDECODE
  delete env.CLAUDE_CODE
  return env
}

async function runClaudeCode(task: string, channel: string, thread: string): Promise<void> {
  const sessionKey = `${channel}:${thread}`
  if (activeSessions.has(sessionKey)) return
  activeSessions.add(sessionKey)

  await postReply(channel, thread, `🚀 Starting Claude Code...\n> ${task.slice(0, 300)}`)
  console.log(`\n🚀 Running Claude Code: ${task.slice(0, 80)}...`)

  try {
    const result = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve, reject) => {
      const proc = spawn("claude", ["-p", task, "--output-format", "text"], {
        cwd: PROJECT_DIR,
        env: cleanEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      })

      let stdout = ""
      let stderr = ""
      let progressSent = false

      proc.stdout.on("data", (chunk) => {
        const text = chunk.toString()
        stdout += text
        process.stdout.write(text) // mirror to bot console
        if (!progressSent && stdout.length > 200) {
          progressSent = true
          postReply(channel, thread, `⚙️ Claude Code is working...\n\`\`\`\n${stdout.slice(0, 800)}\n\`\`\``).catch(() => {})
        }
      })

      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString()
      })

      const timeout = setTimeout(() => {
        proc.kill()
        reject(new Error("Claude Code timed out after 10 minutes"))
      }, 10 * 60 * 1000)

      proc.on("exit", (code) => {
        clearTimeout(timeout)
        console.log(`\n✅ Claude Code exited with code ${code}, stdout ${stdout.length} bytes`)
        resolve({ stdout, stderr, code: code ?? 1 })
      })

      proc.on("error", (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })

    if (result.code === 0 && result.stdout.trim()) {
      await postReply(channel, thread, `✅ *Task completed!*\n\n${result.stdout.trim()}`)
    } else if (result.code !== 0) {
      const errMsg = result.stderr.trim() || result.stdout.trim() || "Unknown error"
      await postReply(channel, thread, `❌ Claude Code exited with code ${result.code}:\n\`\`\`\n${errMsg.slice(0, 1500)}\n\`\`\``)
    } else {
      await postReply(channel, thread, "⚠️ Claude Code completed but produced no output.")
    }
  } catch (err: any) {
    await postReply(channel, thread, `❌ Error: ${err.message}`)
  } finally {
    activeSessions.delete(sessionKey)
  }
}

app.message(async ({ message }) => {
  if (message.subtype) return
  if (!("text" in message) || !message.text) return

  const msgId = message.ts
  if (seenMessages.has(msgId)) return
  seenMessages.add(msgId)
  if (seenMessages.size > 1000) {
    const first = seenMessages.values().next().value
    if (first) seenMessages.delete(first)
  }

  const userId = ("user" in message ? message.user : undefined) ?? ""
  if (ALLOWED_USERS.length > 0 && !ALLOWED_USERS.includes(userId)) return

  const botId = (message as any).bot_id
  if (botId && !ALLOWED_USERS.includes(userId)) return

  const text = message.text.trim()
  const channel = message.channel
  const thread = (message as any).thread_ts || message.ts

  console.log(`\n📨 [${userId}] ${text.slice(0, 100)}`)
  await runClaudeCode(text, channel, thread)
})

await app.start()
console.log("🤖 Argus Claude Bot is running!")
console.log(`   Project dir: ${PROJECT_DIR}`)
console.log(`   Allowed users: ${ALLOWED_USERS.length > 0 ? ALLOWED_USERS.join(", ") : "all"}`)
console.log("   Waiting for Slack messages...\n")
