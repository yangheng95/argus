import type { Argv } from "yargs"
import { Session } from "../../session"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { EOL } from "os"
import path from "path"
import { Filesystem } from "../../util/filesystem"
import { LLMTrace } from "../../session/llm-trace"
import { buildSessionTraceHtml } from "./export-html"

export const ExportCommand = cmd({
  command: "export [sessionID]",
  describe: "export session data as JSON or HTML trace report",
  builder: (yargs: Argv) => {
    return yargs
      .positional("sessionID", {
        describe: "session id to export",
        type: "string",
      })
      .option("html", {
        describe: "export as HTML report (conversation + LLM call trace + screenshots)",
        type: "boolean",
        default: false,
      })
      .option("out", {
        describe: "output HTML file path (used with --html)",
        type: "string",
      })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      let sessionID = args.sessionID
      process.stderr.write(`Exporting session: ${sessionID ?? "latest"}\n`)

      if (!sessionID) {
        UI.empty()
        prompts.intro("Export session", {
          output: process.stderr,
        })

        const sessions = []
        for await (const session of Session.list()) {
          sessions.push(session)
        }

        if (sessions.length === 0) {
          prompts.log.error("No sessions found", {
            output: process.stderr,
          })
          prompts.outro("Done", {
            output: process.stderr,
          })
          return
        }

        sessions.sort((a, b) => b.time.updated - a.time.updated)

        const selectedSession = await prompts.autocomplete({
          message: "Select session to export",
          maxItems: 10,
          options: sessions.map((session) => ({
            label: session.title,
            value: session.id,
            hint: `${new Date(session.time.updated).toLocaleString()} • ${session.id.slice(-8)}`,
          })),
          output: process.stderr,
        })

        if (prompts.isCancel(selectedSession)) {
          throw new UI.CancelledError()
        }

        sessionID = selectedSession as string

        prompts.outro("Exporting session...", {
          output: process.stderr,
        })
      }

      try {
        const sessionInfo = await Session.get(sessionID!)
        const messages = await Session.messages({ sessionID: sessionID! })
        const html = args.html === true

        if (html) {
          const calls = await LLMTrace.read(sessionID!)
          const report = await buildSessionTraceHtml({
            session: {
              id: sessionInfo.id,
              title: sessionInfo.title,
              time: sessionInfo.time,
            },
            messages,
            calls,
          })
          const out = path.resolve(process.cwd(), String(args.out ?? `opencorvus-trace-${sessionID}.html`))
          await Filesystem.write(out, report)
          process.stdout.write(out)
          process.stdout.write(EOL)
          return
        }

        const exportData = {
          info: sessionInfo,
          messages: messages.map((msg) => ({
            info: msg.info,
            parts: msg.parts,
          })),
        }

        process.stdout.write(JSON.stringify(exportData, null, 2))
        process.stdout.write(EOL)
      } catch (error) {
        UI.error(`Session not found: ${sessionID!}`)
        process.exit(1)
      }
    })
  },
})
