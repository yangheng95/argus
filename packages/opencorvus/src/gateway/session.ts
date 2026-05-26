import { sql } from "drizzle-orm"
import { Database, and, eq } from "@/storage/db"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionTable } from "@/session/session.sql"

export type GatewaySession = Session.Info & { channelKey: string }

const locks = new Map<string, Promise<GatewaySession>>()

function withChannelKey(session: Session.Info, channelKey: string): GatewaySession {
  return { ...session, channelKey }
}

function findGatewaySessionID(channelKey: string) {
  return Database.use((db) =>
    db
      .select({ id: SessionTable.id })
      .from(SessionTable)
      .where(and(
        eq(SessionTable.project_id, Instance.project.id),
        eq(SessionTable.kind, "gateway"),
        sql`json_extract(${SessionTable.metadata}, '$.gateway.channelKey') = ${channelKey}`,
      ))
      .get()
      ?.id,
  )
}

/**
 * Look up an existing gateway session by channelKey without creating one.
 *
 * The /gateway/master/wake route uses this to distinguish "started a
 * new mission" from "resumed an existing mission" in its response. The
 * actual session acquisition still goes through `ensureGatewaySession`
 * — this lookup intentionally has no create semantics.
 */
export function findExistingGatewaySession(channelKey: string): string | undefined {
  return findGatewaySessionID(channelKey)
}

async function ensureGatewaySessionInner(input: { channelKey: string; defaultCwd: string }) {
  const existingID = findGatewaySessionID(input.channelKey)
  if (existingID) return withChannelKey(await Session.get(existingID), input.channelKey)

  const created = await Session.createNext({
    kind: "gateway",
    title: "Gateway Control",
    directory: input.defaultCwd,
  })
  const updated = await Session.mergeMetadata({
    sessionID: created.id,
    patch: {
      gateway: {
        channelKey: input.channelKey,
        cwd: input.defaultCwd,
      },
    },
  })
  return withChannelKey(updated, input.channelKey)
}

export async function ensureGatewaySession(input: { channelKey: string; defaultCwd: string }) {
  const lockKey = `${Instance.project.id}:${input.channelKey}`
  const existing = locks.get(lockKey)
  if (existing) return existing

  const promise = ensureGatewaySessionInner(input).finally(() => locks.delete(lockKey))
  locks.set(lockKey, promise)
  return promise
}
