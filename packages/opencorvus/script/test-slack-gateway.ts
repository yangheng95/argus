/**
 * Minimal Slack gateway test script — bypasses CLI/yargs layer.
 * Starts the SlackGateway directly, creates Instance context manually.
 */
import { SlackGateway } from "@/channel/slack"
import { Log } from "@/util/log"

const log = Log.create({ service: "test-slack" })

async function main() {
  console.error("[test-slack] Starting...")

  await Log.init({ print: true, level: "DEBUG" })

  const token = process.env.SLACK_BOT_TOKEN
  const appToken = process.env.SLACK_APP_TOKEN
  const signingSecret = process.env.SLACK_SIGNING_SECRET

  if (!token) { console.error("SLACK_BOT_TOKEN missing"); process.exit(1) }
  if (!appToken) { console.error("SLACK_APP_TOKEN missing"); process.exit(1) }

  console.error(`[test-slack] Bot token: ${token.slice(0, 10)}...`)
  console.error(`[test-slack] App token: ${appToken.slice(0, 10)}...`)
  console.error(`[test-slack] CWD: ${process.cwd()}`)

  const gateway = new SlackGateway({
    directory: process.cwd(),
    token,
    appToken,
    signingSecret,
  })

  console.error("[test-slack] Calling gateway.start()...")
  await gateway.start()
  console.error("[test-slack] Gateway started successfully!")

  // Keep alive
  await new Promise(() => {})
}

main().catch((err) => {
  console.error("[test-slack] FATAL:", err)
  process.exit(1)
})
