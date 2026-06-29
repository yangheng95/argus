import type { Argv } from "yargs"
import type { Part, VisibleMessage } from "@opencorvus-ai/sdk"
import { Session } from "../../session"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Database } from "../../storage/db"
import { SessionTable, MessageTable, PartTable } from "../../session/session.sql"
import { EOL } from "os"
import { Filesystem } from "../../util/filesystem"

export class ImportFileMissingError extends Error {
  constructor(file: string) {
    super(`Import file not found: ${file}`)
    this.name = "ImportFileMissingError"
  }
}

export class ImportFileInvalidJsonError extends Error {
  constructor(file: string, options?: ErrorOptions) {
    super(`Import file is not valid JSON: ${file}`, options)
    this.name = "ImportFileInvalidJsonError"
  }
}

type SessionImportData = {
  info: Session.Info
  messages: Array<{
    info: VisibleMessage
    parts: Part[]
  }>
}

function isEnoent(error: unknown): error is { code: "ENOENT" } {
  return (
    typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "ENOENT"
  )
}

export async function readSessionImportFile(file: string): Promise<SessionImportData> {
  let text: string
  try {
    text = await Filesystem.readText(file)
  } catch (error) {
    if (isEnoent(error)) throw new ImportFileMissingError(file)
    throw error
  }
  try {
    return JSON.parse(text) as SessionImportData
  } catch (error) {
    throw new ImportFileInvalidJsonError(file, { cause: error })
  }
}

export function importSessionData(exportData: SessionImportData) {
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
}

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
      const exportData = await readSessionImportFile(args.file)
      importSessionData(exportData)

      process.stdout.write(`Imported session: ${exportData.info.id}`)
      process.stdout.write(EOL)
    })
  },
})
