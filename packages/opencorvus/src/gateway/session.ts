/**
 * Gateway session lookup / creation.
 *
 * Gateway sessions are per-(platform, channel, user) singletons. The DB has a
 * partial unique index (`session_gateway_singleton_idx`) that prevents two rows
 * sharing a `channel_key`, so this module is a thin get-or-create on top of
 * `Session.createNext`. On race the unique index throws; we recover by re-reading.
 */

import { Database, eq, and } from "@/storage/db"
import { SessionTable } from "@/session/session.sql"
import { Session } from "@/session"

export async function ensureGatewaySession(input: {
  channelKey: string
  /** Default cwd for tool calls inside this gateway session. Stored in
   *  `metadata.gateway.cwd`; `switch_cwd` updates it later. Falls back to the
   *  ambient instance worktree at session creation time. */
  defaultCwd: string
  /** Optional title shown to the user in the dialog list. */
  title?: string
}): Promise<Session.Info> {
  const existing = Database.use((db) =>
    db
      .select()
      .from(SessionTable)
      .where(and(eq(SessionTable.kind, "gateway"), eq(SessionTable.channel_key, input.channelKey)))
      .get(),
  )
  if (existing) return Session.fromRow(existing)

  // Race-safe create: if another caller wins the unique index, re-read.
  try {
    const created = await Session.createNext({
      directory: input.defaultCwd,
      kind: "gateway",
      channelKey: input.channelKey,
      title: input.title ?? `Gateway · ${input.channelKey}`,
    })
    // Initialize cwd state at creation time so the first tool call has a value.
    await Session.mergeMetadata({
      sessionID: created.id,
      patch: { gateway: { cwd: input.defaultCwd } },
    })
    return await Session.get(created.id)
  } catch (err) {
    const raced = Database.use((db) =>
      db
        .select()
        .from(SessionTable)
        .where(and(eq(SessionTable.kind, "gateway"), eq(SessionTable.channel_key, input.channelKey)))
        .get(),
    )
    if (raced) return Session.fromRow(raced)
    throw err
  }
}
