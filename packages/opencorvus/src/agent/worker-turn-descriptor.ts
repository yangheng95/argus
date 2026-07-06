import { createHash } from "node:crypto"
import z from "zod"
import { desc, eq } from "@/storage/db"
import { Database } from "@/storage/db"
import { Identifier } from "@/id/id"
import { WorkerTurnDescriptorTable } from "@/session/session.sql"

export namespace WorkerTurnDescriptor {
  export const Payload = z.object({
    agent: z.string(),
    roleContractID: z.string(),
    model: z.object({
      providerID: z.string(),
      modelID: z.string(),
    }),
    prompt: z.object({
      systemMode: z.enum(["append_to_agent", "complete"]).optional(),
      rawSystemPrompt: z.boolean(),
    }),
    tools: z.object({
      enabled: z.array(z.string()),
      switches: z.record(z.string(), z.boolean()).optional(),
      terminal: z.string().optional(),
    }),
    capability: z
      .object({
        promptProfileID: z.string(),
        capabilityProfileID: z.string(),
        projectionHash: z.string(),
      })
      .optional(),
    output: z.object({
      format: z.enum(["text", "json_schema"]),
      resultMode: z.enum(["reply", "summary"]).default("reply"),
    }),
    workflow: z.object({
      taskID: z.string().optional(),
      goalID: z.string().optional(),
      goalRunID: z.string().optional(),
      attemptID: z.string().optional(),
      sessionKind: z.string(),
    }),
  })
  export type Payload = z.infer<typeof Payload>

  export const Info = z.object({
    id: z.string(),
    sessionID: z.string(),
    hash: z.string(),
    agent: z.string(),
    payload: Payload,
    time: z.object({
      created: z.number(),
      updated: z.number(),
    }),
  })
  export type Info = z.infer<typeof Info>

  function stable(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
    if (value && typeof value === "object") {
      return `{${Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
        .join(",")}}`
    }
    return JSON.stringify(value)
  }

  export function hash(payload: Payload): string {
    return createHash("sha256").update(stable(payload)).digest("hex")
  }

  function fromRow(row: typeof WorkerTurnDescriptorTable.$inferSelect): Info {
    return {
      id: row.id,
      sessionID: row.session_id,
      hash: row.hash,
      agent: row.agent,
      payload: Payload.parse(row.payload),
      time: {
        created: row.time_created,
        updated: row.time_updated,
      },
    }
  }

  export function create(input: { sessionID: string; payload: Payload }): Info {
    const now = Date.now()
    const parsed = Payload.parse(input.payload)
    const row = {
      id: Identifier.ascending("worker_turn_descriptor"),
      session_id: input.sessionID,
      hash: hash(parsed),
      agent: parsed.agent,
      payload: parsed,
      time_created: now,
      time_updated: now,
    } satisfies typeof WorkerTurnDescriptorTable.$inferInsert
    Database.use((db) => db.insert(WorkerTurnDescriptorTable).values(row).run())
    return fromRow(row)
  }

  export function latestForSession(sessionID: string): Info | undefined {
    return Database.use((db) => {
      const row = db
        .select()
        .from(WorkerTurnDescriptorTable)
        .where(eq(WorkerTurnDescriptorTable.session_id, sessionID))
        .orderBy(desc(WorkerTurnDescriptorTable.time_created), desc(WorkerTurnDescriptorTable.id))
        .get()
      return row ? fromRow(row) : undefined
    })
  }

  export function get(input: { id: string; sessionID: string }): Info | undefined {
    return Database.use((db) => {
      const row = db.select().from(WorkerTurnDescriptorTable).where(eq(WorkerTurnDescriptorTable.id, input.id)).get()
      if (!row || row.session_id !== input.sessionID) return undefined
      return fromRow(row)
    })
  }
}
