import type { Argv } from "yargs"
import type { Message, Part } from "@opencorvus-ai/sdk/v2"
import { Session } from "../../session"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Database } from "../../storage/db"
import { SessionTable, MessageTable, PartTable } from "../../session/session.sql"
import { EOL } from "os"
import { Filesystem } from "../../util/filesystem"

export const ImportCommand = cmd({
  command: "import <file>",
  describe: "import session data from JSON file",
  builder: (yargs: Argv) => {
    return yargs.positional("file", {
      describe: "path to JSON file",
      type: "string",
      demandOption: true,
    })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      let exportData:
        | {
            info: Session.Info
            messages: Array<{
              info: Message
              parts: Part[]
            }>
          }
        | undefined

      // Parse failure handled below with user-facing error message
      exportData = await Filesystem.readJson<NonNullable<typeof exportData>>(args.file).catch(() => undefined)
      if (!exportData) {
        process.stdout.write(`Failed to read or parse session data from: ${args.file}`)
        process.stdout.write(EOL)
        return
      }

      Database.use((db) => db.insert(SessionTable).values(Session.toRow(exportData.info)).onConflictDoNothing().run())

      for (const msg of exportData.messages) {
        Database.use((db) =>
          db
            .insert(MessageTable)
            .values({
              id: msg.info.id,
              session_id: exportData.info.id,
              time_created: msg.info.time?.created ?? Date.now(),
              data: msg.info,
            })
            .onConflictDoNothing()
            .run(),
        )

        for (const part of msg.parts) {
          Database.use((db) =>
            db
              .insert(PartTable)
              .values({
                id: part.id,
                message_id: msg.info.id,
                session_id: exportData.info.id,
                data: part,
              })
              .onConflictDoNothing()
              .run(),
          )
        }
      }

      process.stdout.write(`Imported session: ${exportData.info.id}`)
      process.stdout.write(EOL)
    })
  },
})
