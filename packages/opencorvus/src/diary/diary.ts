import { Database, eq, desc, like, asc } from "@/storage/db"
import { DiaryTable } from "./diary.sql"
import z from "zod"

export namespace Diary {
  export const Entry = z.object({
    id: z.string(),
    date: z.string(),
    title: z.string(),
    content: z.string(),
    mood: z.string().optional(),
    image_paths: z.array(z.string()).optional(),
    time_created: z.number().optional(),
    time_updated: z.number().optional(),
  })
  export type Entry = z.infer<typeof Entry>

  export const ListOptions = z.object({
    limit: z.number().optional(),
    offset: z.number().optional(),
    sortBy: z.enum(["date", "time_created", "time_updated"]).optional().default("date"),
    sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
  })
  export type ListOptions = z.infer<typeof ListOptions>

  export const SearchQuery = z.object({
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    title: z.string().optional(),
  })
  export type SearchQuery = z.infer<typeof SearchQuery>

  export function create(entry: Omit<Entry, "id" | "time_created" | "time_updated">): Entry {
    const id = crypto.randomUUID()
    const now = Date.now()
    
    Database.transaction((db) => {
      db.insert(DiaryTable)
        .values({
          id,
          date: entry.date,
          title: entry.title,
          content: entry.content,
          mood: entry.mood ?? null,
          image_paths: entry.image_paths ? JSON.stringify(entry.image_paths) : null,
          time_created: now,
          time_updated: now,
        })
        .run()
    })

    return {
      id,
      date: entry.date,
      title: entry.title,
      content: entry.content,
      mood: entry.mood,
      image_paths: entry.image_paths,
      time_created: now,
      time_updated: now,
    }
  }

  export function read(id: string): Entry | null {
    const row = Database.use((db) =>
      db.select().from(DiaryTable).where(eq(DiaryTable.id, id)).get()
    )
    
    if (!row) return null
    
    return {
      id: row.id,
      date: row.date,
      title: row.title,
      content: row.content,
      mood: row.mood ?? undefined,
      image_paths: row.image_paths ? JSON.parse(row.image_paths) : undefined,
      time_created: row.time_created,
      time_updated: row.time_updated,
    }
  }

  export function update(id: string, entry: Partial<Pick<Entry, "date" | "title" | "content" | "mood" | "image_paths">>): Entry | null {
    const now = Date.now()
    
    const existing = read(id)
    if (!existing) return null

    Database.transaction((db) => {
      const updateValues: any = {
        date: entry.date ?? existing.date,
        title: entry.title ?? existing.title,
        content: entry.content ?? existing.content,
        mood: entry.mood ?? existing.mood ?? null,
        time_updated: now,
      }
      
      if (entry.image_paths !== undefined) {
        updateValues.image_paths = JSON.stringify(entry.image_paths)
      } else if (existing.image_paths !== undefined) {
        updateValues.image_paths = JSON.stringify(existing.image_paths)
      } else {
        updateValues.image_paths = null
      }
      
      db.update(DiaryTable)
        .set(updateValues)
        .where(eq(DiaryTable.id, id))
        .run()
    })

    return {
      ...existing,
      date: entry.date ?? existing.date,
      title: entry.title ?? existing.title,
      content: entry.content ?? existing.content,
      mood: entry.mood ?? existing.mood,
      image_paths: entry.image_paths ?? existing.image_paths,
      time_updated: now,
    }
  }

  export function remove(id: string): boolean {
    const existing = read(id)
    if (!existing) return false

    Database.transaction((db) => {
      db.delete(DiaryTable).where(eq(DiaryTable.id, id)).run()
    })

    return true
  }

  export function list(options: ListOptions = {} as ListOptions): Entry[] {
    const { limit = 100, offset = 0, sortBy = "date", sortOrder = "desc" } = options
    
    const column = 
      sortBy === "date" ? DiaryTable.date :
      sortBy === "time_created" ? DiaryTable.time_created :
      DiaryTable.time_updated
    
    const orderBy = sortOrder === "asc" ? asc(column) : desc(column)
    
    const rows = Database.use((db) =>
      db.select().from(DiaryTable).orderBy(orderBy).limit(limit).offset(offset).all()
    )

    return rows.map((row) => ({
      id: row.id,
      date: row.date,
      title: row.title,
      content: row.content,
      mood: row.mood ?? undefined,
      image_paths: row.image_paths ? JSON.parse(row.image_paths) : undefined,
      time_created: row.time_created,
      time_updated: row.time_updated,
    }))
  }

  export function search(query: SearchQuery): Entry[] {
    const rows = Database.use((db) => {
      return db.select().from(DiaryTable).orderBy(desc(DiaryTable.date)).all()
    })

    // Filter by date range and title in memory
    let result = rows.map((row) => ({
      id: row.id,
      date: row.date,
      title: row.title,
      content: row.content,
      mood: row.mood ?? undefined,
      image_paths: row.image_paths ? JSON.parse(row.image_paths) : undefined,
      time_created: row.time_created,
      time_updated: row.time_updated,
    }))

    if (query.dateFrom) {
      result = result.filter((entry) => entry.date >= query.dateFrom!)
    }
    if (query.dateTo) {
      result = result.filter((entry) => entry.date <= query.dateTo!)
    }
    if (query.title) {
      const keyword = query.title.toLowerCase()
      result = result.filter((entry) => 
        entry.title.toLowerCase().includes(keyword) ||
        entry.content.toLowerCase().includes(keyword)
      )
    }

    return result
  }
}
