import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { Timestamps } from "@/storage/schema.sql"

export const DiaryTable = sqliteTable(
  "diary",
  {
    id: text().primaryKey(),
    date: text().notNull(),
    title: text().notNull(),
    content: text().notNull(),
    mood: text(),
    image_paths: text(),
    ...Timestamps,
  },
  (table) => [
    index("diary_date_idx").on(table.date),
    index("diary_created_idx").on(table.time_created),
  ],
)
