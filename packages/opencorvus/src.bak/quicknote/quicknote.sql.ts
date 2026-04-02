import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

/**
 * QuickNote 数据表 — matches DDL in storage/ddl.ts
 */
export const QuickNoteTable = sqliteTable("quick_note", {
  id: text().primaryKey(),
  project_id: text(),
  content: text().notNull(),
  summary: text().notNull(),
  tags: text().notNull().default("[]"),
  status: text().notNull().default("draft"),
  user_id: text(),
  time_created: integer().notNull(),
  time_updated: integer().notNull(),
})
