import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { SessionTable } from "../session/session.sql"
import { Timestamps } from "@/storage/schema.sql"

export const ScratchpadTable = sqliteTable("scratchpad", {
  session_id: text()
    .primaryKey()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  content: text().notNull().default(""),
  ...Timestamps,
})
