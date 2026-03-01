import { sqliteTable, text, integer, index, blob } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/project.sql"
import { Timestamps } from "@/storage/schema.sql"

export const MemoryFileTable = sqliteTable(
  "memory_file",
  {
    id: text().primaryKey(),
    project_id: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    title: text().notNull(),
    source: text().notNull().$type<"agent" | "compaction" | "user">(),
    ...Timestamps,
  },
  (table) => [index("memory_file_project_idx").on(table.project_id)],
)

export const MemoryChunkTable = sqliteTable(
  "memory_chunk",
  {
    id: text().primaryKey(),
    file_id: text()
      .notNull()
      .references(() => MemoryFileTable.id, { onDelete: "cascade" }),
    project_id: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    content: text().notNull(),
    token_count: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("memory_chunk_file_idx").on(table.file_id),
    index("memory_chunk_project_idx").on(table.project_id),
  ],
)

export const MemoryEmbeddingTable = sqliteTable("memory_embedding", {
  chunk_id: text()
    .primaryKey()
    .references(() => MemoryChunkTable.id, { onDelete: "cascade" }),
  embedding: blob().notNull(),
  model: text().notNull(),
  ...Timestamps,
})
