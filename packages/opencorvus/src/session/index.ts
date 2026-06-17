import { Slug } from "@opencorvus-ai/util/slug"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Decimal } from "decimal.js"
import z from "zod"
import { type LanguageModelUsage, type ProviderMetadata } from "ai"
import { Config } from "../config/config"
import { Flag } from "../flag/flag"
import { Identifier } from "../id/id"
import { Installation } from "../installation"

import { Database, NotFoundError, eq, and, gte, isNull, desc, like, inArray, lt } from "../storage/db"
import type { SQL } from "../storage/db"
import { SessionTable, MessageTable, PartTable, SESSION_KINDS, type SessionKind } from "./session.sql"
import { ProjectTable } from "../project/project.sql"
import { Log } from "../util/log"
import { Message } from "./message"
import { SessionEvents } from "./events"
import { Instance } from "../project/instance"
import path from "path"
import { fn } from "@/util/fn"
import { Command } from "../command"
import { Snapshot } from "@/snapshot"
import { Filesystem } from "@/util/filesystem"
import { ProjectRuntimePaths } from "@/project/runtime-paths"

import type { Provider } from "@/provider/provider"
import { PermissionNext } from "@/permission/next"
import { iife } from "@/util/iife"
import { NamedError } from "@opencorvus-ai/util/error"

export namespace Session {
  const log = Log.create({ service: "session" })

  // [observability/phase-0] Dedupe set for the cache_write extraction-miss log
  // in getUsage(). Keyed by `${providerID}/${modelID}` so we emit one structured
  // sample per distinct provider+model combination per process lifetime.
  const cacheWriteMissLogged = new Set<string>()

  const parentTitlePrefix = "New session - "
  const childTitlePrefix = "Child session - "

  function createDefaultTitle(isChild = false) {
    return (isChild ? childTitlePrefix : parentTitlePrefix) + new Date().toISOString()
  }

  export function isDefaultTitle(title: string) {
    return new RegExp(
      `^(${parentTitlePrefix}|${childTitlePrefix})\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$`,
    ).test(title)
  }

  type SessionRow = typeof SessionTable.$inferSelect

  export function fromRow(row: SessionRow): Info {
    const summary =
      row.summary_additions !== null || row.summary_deletions !== null || row.summary_files !== null
        ? {
            additions: row.summary_additions ?? 0,
            deletions: row.summary_deletions ?? 0,
            files: row.summary_files ?? 0,
          }
        : undefined
    const share = row.share_url ? { url: row.share_url } : undefined
    return {
      id: row.id,
      slug: row.slug,
      projectID: row.project_id,
      directory: row.directory,
      parentID: row.parent_id ?? undefined,
      title: row.title,
      version: row.version,
      kind: row.kind,
      goalID: row.goal_id ?? undefined,
      metadata: row.metadata ?? undefined,
      summary,
      share,
      permission: row.permission ?? undefined,
      time: {
        created: row.time_created,
        updated: row.time_updated,
        compacting: row.time_compacting ?? undefined,
        archived: row.time_archived ?? undefined,
      },
    }
  }

  export function toRow(info: Info) {
    return {
      id: info.id,
      project_id: info.projectID,
      parent_id: info.parentID,
      slug: info.slug,
      directory: info.directory,
      title: info.title,
      version: info.version,
      kind: info.kind,
      goal_id: info.goalID ?? null,
      metadata: info.metadata ?? null,
      share_url: info.share?.url,
      summary_additions: info.summary?.additions,
      summary_deletions: info.summary?.deletions,
      summary_files: info.summary?.files,
      permission: info.permission,
      time_created: info.time.created,
      time_updated: info.time.updated,
      time_compacting: info.time.compacting,
      time_archived: info.time.archived,
    }
  }

  function getForkedTitle(title: string): string {
    const match = title.match(/^(.+) \(fork #(\d+)\)$/)
    if (match) {
      const base = match[1]
      const num = parseInt(match[2], 10)
      return `${base} (fork #${num + 1})`
    }
    return `${title} (fork #1)`
  }

  export const Info = z
    .object({
      id: Identifier.schema("session"),
      slug: z.string(),
      projectID: z.string(),
      directory: z.string(),
      parentID: Identifier.schema("session").optional(),
      summary: z
        .object({
          additions: z.number(),
          deletions: z.number(),
          files: z.number(),
        })
        .optional(),
      share: z
        .object({
          url: z.string(),
        })
        .optional(),
      title: z.string(),
      version: z.string(),
      /** Session's role/purpose, fixed at creation. Authoritative source of
       *  "what is this session for"; UI channel routing reads this column
       *  directly. See SessionKind in session.sql.ts. */
      kind: z.enum(SESSION_KINDS),
      /** Goal this session belongs to (executor container / build
       *  worker / evaluator only); drives overlay card nesting. Fixed at
       *  creation. */
      goalID: Identifier.schema("goal").optional(),
      /** Free-form per-session state. */
      metadata: z.record(z.string(), z.any()).optional(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
        compacting: z.number().optional(),
        archived: z.number().optional(),
      }),
      permission: PermissionNext.Ruleset.optional(),
    })
    .meta({
      ref: "Session",
    })
  export type Info = z.output<typeof Info>

  export const ProjectInfo = z
    .object({
      id: z.string(),
      name: z.string().optional(),
      worktree: z.string(),
    })
    .meta({
      ref: "ProjectSummary",
    })
  export type ProjectInfo = z.output<typeof ProjectInfo>

  export const GlobalInfo = Info.extend({
    project: ProjectInfo.nullable(),
  }).meta({
    ref: "GlobalSession",
  })
  export type GlobalInfo = z.output<typeof GlobalInfo>

  export const Event = {
    Created: BusEvent.define(
      "session.created",
      z.object({
        info: Info,
      }),
    ),
    Updated: BusEvent.define(
      "session.updated",
      z.object({
        info: Info,
      }),
    ),
    Deleted: BusEvent.define(
      "session.deleted",
      z.object({
        info: Info,
      }),
    ),
    Diff: BusEvent.define(
      "session.diff",
      z.object({
        sessionID: z.string(),
        diff: Snapshot.FileDiff.array(),
      }),
    ),
    ConfigChanged: BusEvent.define(
      "config.changed",
      z.object({
        sessionID: z.string(),
      }),
    ),
    Error: SessionEvents.Error,
  }

  export const create = fn(
    z.object({
      kind: Info.shape.kind,
      goalID: Info.shape.goalID,
      parentID: Identifier.schema("session").optional(),
      title: z.string().optional(),
      permission: Info.shape.permission,
      metadata: Info.shape.metadata,
    }),
    async (input) => {
      return createNext({
        kind: input.kind,
        goalID: input.goalID,
        parentID: input.parentID,
        directory: Instance.directory,
        title: input.title,
        permission: input.permission,
        metadata: input.metadata,
      })
    },
  )

  export const fork = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message").optional(),
    }),
    async (input) => {
      const original = await get(input.sessionID)
      if (!original) throw new Error("session not found")
      const title = getForkedTitle(original.title)
      // fork = clone: inherits the original session's kind and goal. This
      // is the session's identity, not a default — forking a "acceptance"
      // session into an "executor" container would be semantically broken.
      const session = await createNext({
        directory: Instance.directory,
        parentID: input.sessionID,
        kind: original.kind,
        goalID: original.goalID,
        title,
      })
      const msgs = await messages({ sessionID: input.sessionID })
      const idMap = new Map<string, string>()

      for (const msg of msgs) {
        if (input.messageID && msg.info.id >= input.messageID) break
        const newID = Identifier.ascending("message")
        idMap.set(msg.info.id, newID)

        const parentID = msg.info.role === "assistant" && msg.info.parentID ? idMap.get(msg.info.parentID) : undefined
        const cloned = await updateMessage({
          ...msg.info,
          sessionID: session.id,
          id: newID,
          ...(parentID && { parentID }),
        })

        for (const part of msg.parts) {
          await updatePart({
            ...part,
            id: Identifier.ascending("part"),
            messageID: cloned.id,
            sessionID: session.id,
          })
        }
      }
      return session
    },
  )

  export const touch = fn(Identifier.schema("session"), async (sessionID) => {
    const now = Date.now()
    Database.use((db) => {
      const row = db
        .update(SessionTable)
        .set({ time_updated: now })
        .where(eq(SessionTable.id, sessionID))
        .returning()
        .get()
      if (!row) throw new NotFoundError({ message: `Session not found: ${sessionID}` })
      const info = fromRow(row)
      Database.effect(() => Bus.publish(Event.Updated, { info }))
    })
  })

  export async function createNext(input: {
    /** Required. The session's role/purpose — see SessionKind in session.sql.ts.
     *  Authoritative for UI channel routing. There is NO default: every
     *  caller must state what the session is for. */
    kind: SessionKind
    /** Goal this session belongs to (executor/build only). Pass it
     *  at creation so sessionGoalID() is a pure DB lookup — never inferred
     *  from parent chains or registry state. */
    goalID?: string
    id?: string
    title?: string
    parentID?: string
    directory: string
    permission?: PermissionNext.Ruleset
    metadata?: Record<string, unknown>
  }) {
    const result: Info = {
      id: Identifier.descending("session", input.id),
      slug: Slug.create(),
      version: Installation.VERSION,
      projectID: Instance.project.id,
      directory: input.directory,
      parentID: input.parentID,
      title: input.title ?? createDefaultTitle(!!input.parentID),
      kind: input.kind,
      goalID: input.goalID,
      metadata: input.metadata,
      permission: input.permission,
      time: {
        created: Date.now(),
        updated: Date.now(),
      },
    }
    log.info("created", result)
    Database.use((db) => {
      db.insert(SessionTable).values(toRow(result)).run()
      Database.effect(() =>
        Bus.publish(Event.Created, {
          info: result,
        }),
      )
    })
    Bus.publish(Event.Updated, {
      info: result,
    })
    return result
  }

  const SessionProjectInput = z.object({
    sessionID: Identifier.schema("session"),
    projectID: z.string().min(1),
  })

  export const getInProject = fn(SessionProjectInput, async ({ sessionID, projectID }) => {
    const row = Database.use((db) =>
      db
        .select()
        .from(SessionTable)
        .where(and(eq(SessionTable.id, sessionID), eq(SessionTable.project_id, projectID)))
        .get(),
    )
    if (!row) throw new NotFoundError({ message: `Session not found: ${sessionID}` })
    return fromRow(row)
  })

  export const get = fn(Identifier.schema("session"), async (id) => {
    const row = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, id)).get())
    if (!row) throw new NotFoundError({ message: `Session not found: ${id}` })
    return fromRow(row)
  })

  export const setTitle = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      title: z.string(),
    }),
    async (input) => {
      return Database.use((db) => {
        const row = db
          .update(SessionTable)
          .set({ title: input.title, time_updated: Date.now() })
          .where(eq(SessionTable.id, input.sessionID))
          .returning()
          .get()
        if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
        const info = fromRow(row)
        Database.effect(() => Bus.publish(Event.Updated, { info }))
        return info
      })
    },
  )

  /**
   * A session config overlay (model / prompt / temperature) is owned by the
   * ROOT session only (task root or standalone root) — R5.1 item 2. Child
   * execution sessions run normally but never own a config overlay; they
   * inherit the task-root overlay at resolution time (R5.1 item 5). The
   * settings UI must target the root session, so both GET and PATCH of the
   * session config reject a child session here (single guard, rule 8).
   */
  export const ChildSessionConfigError = NamedError.create(
    "ChildSessionConfigError",
    z.object({
      sessionID: z.string(),
      parentID: z.string(),
      message: z.string(),
    }),
  )

  export function assertConfigurableRoot(session: Info): void {
    if (session.parentID) {
      throw new ChildSessionConfigError({
        sessionID: session.id,
        parentID: session.parentID,
        message:
          `Session ${session.id} is a child session (parent ${session.parentID}); ` +
          `it does not own a config overlay. Target its root session for model/prompt settings.`,
      })
    }
  }

  function assertNoStoredConfigOverlayNull(value: unknown, path = "configOverlay"): void {
    if (value === null) {
      throw new Error(
        `Stored session overlay contains a null at ${path}; ` +
          `configOverlay must be normalized before it is persisted.`,
      )
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        assertNoStoredConfigOverlayNull(child, `${path}.${key}`)
      }
    }
  }

  /**
   * Merge `patch` into `session.metadata`, preserving keys not listed in patch.
   * Atomic at row-level (single UPDATE under transaction). Caller-side merges
   * race with concurrent writers; collapse all metadata writes for one session
   * through the same code path to avoid lost updates.
   */
  export const mergeMetadata = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      patch: z.record(z.string(), z.any()),
    }),
    async (input) => {
      return Database.transaction((db) => {
        const row = db.select().from(SessionTable).where(eq(SessionTable.id, input.sessionID)).get()
        if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
        const current = (row.metadata ?? {}) as Record<string, unknown>
        const next = { ...current, ...input.patch }
        const updated = db
          .update(SessionTable)
          .set({ metadata: next })
          .where(eq(SessionTable.id, input.sessionID))
          .returning()
          .get()!
        const info = fromRow(updated)
        Database.effect(() => Bus.publish(Event.Updated, { info }))
        return info
      })
    },
  )

  const MergeConfigOverlayInput = z.object({
    sessionID: Identifier.schema("session"),
    patch: Config.Overlay,
  })

  export const mergeConfigOverlayInProject = fn(
    MergeConfigOverlayInput.extend({
      projectID: z.string().min(1),
    }),
    async (input) => {
      return Database.transaction((db) => {
        const row = db
          .select()
          .from(SessionTable)
          .where(and(eq(SessionTable.id, input.sessionID), eq(SessionTable.project_id, input.projectID)))
          .get()
        if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
        assertConfigurableRoot(fromRow(row))
        const stored = (row.metadata as Record<string, unknown> | null | undefined)?.configOverlay ?? {}
        assertNoStoredConfigOverlayNull(stored)
        const current = Config.Overlay.parse(stored)
        const nextOverlay = Config.Overlay.parse(Config.mergeOverlay(current as Config.Info, input.patch))
        assertNoStoredConfigOverlayNull(nextOverlay)
        const metadata = {
          ...((row.metadata ?? {}) as Record<string, unknown>),
          configOverlay: nextOverlay,
        }
        const updated = db
          .update(SessionTable)
          .set({ metadata, time_updated: Date.now() })
          .where(and(eq(SessionTable.id, input.sessionID), eq(SessionTable.project_id, input.projectID)))
          .returning()
          .get()!
        const info = fromRow(updated)
        Database.effect(() => Bus.publish(Event.Updated, { info }))
        Database.effect(() => Bus.publish(Event.ConfigChanged, { sessionID: input.sessionID }))
        return info
      })
    },
  )

  export const mergeConfigOverlay = fn(MergeConfigOverlayInput, async (input) => {
    return mergeConfigOverlayInProject({ ...input, projectID: Instance.project.id })
  })

  export const setArchived = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      time: z.number().optional(),
    }),
    async (input) => {
      return Database.use((db) => {
        const row = db
          .update(SessionTable)
          .set({ time_archived: input.time, time_updated: Date.now() })
          .where(eq(SessionTable.id, input.sessionID))
          .returning()
          .get()
        if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
        const info = fromRow(row)
        Database.effect(() => Bus.publish(Event.Updated, { info }))
        return info
      })
    },
  )

  export const setPermission = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      permission: PermissionNext.Ruleset,
    }),
    async (input) => {
      return Database.use((db) => {
        const row = db
          .update(SessionTable)
          .set({ permission: input.permission, time_updated: Date.now() })
          .where(eq(SessionTable.id, input.sessionID))
          .returning()
          .get()
        if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
        const info = fromRow(row)
        Database.effect(() => Bus.publish(Event.Updated, { info }))
        return info
      })
    },
  )

  export const setSummary = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      summary: Info.shape.summary,
    }),
    async (input) => {
      return Database.use((db) => {
        const row = db
          .update(SessionTable)
          .set({
            summary_additions: input.summary?.additions,
            summary_deletions: input.summary?.deletions,
            summary_files: input.summary?.files,
            time_updated: Date.now(),
          })
          .where(eq(SessionTable.id, input.sessionID))
          .returning()
          .get()
        if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
        const info = fromRow(row)
        Database.effect(() => Bus.publish(Event.Updated, { info }))
        return info
      })
    },
  )

  export const diff = fn(Identifier.schema("session"), async (sessionID) => {
    for (const target of ProjectRuntimePaths.sessionDiffPathReadCandidates(
      Instance.directory,
      Instance.project.id,
      sessionID,
    )) {
      try {
        return await Filesystem.readJson<Snapshot.FileDiff[]>(target)
      } catch {}
    }
    return []
  })

  export const messages = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      limit: z.number().optional(),
    }),
    async (input) => {
      const result = [] as Message.WithParts[]
      for await (const msg of Message.stream(input.sessionID)) {
        if (input.limit && result.length >= input.limit) break
        result.push(msg)
      }
      result.reverse()
      return result
    },
  )

  /**
   * Snapshot the latest assistant message in a session for fact-check
   * idempotency keying. Per specs/fact-check-agent-2026-05-25.md §3.3.
   *
   * Returns `finished=false` when SessionStatus is currently streaming or
   * retrying — fact-check tooling treats that as a reject signal (do not
   * verify a moving target). When `finished=true`, callers use the
   * returned `messageID` + `contentHash` as part of the idempotency key.
   *
   * `contentHash` is sha-256 over the concatenated text/reasoning parts of
   * the latest assistant message. Non-text parts (tool calls, files,
   * snapshots) are intentionally excluded — fact-check verifies factual
   * claims in natural-language output, not tool plumbing.
   */
  export const snapshotLatestAssistant = fn(
    Identifier.schema("session"),
    async (
      sessionID,
    ): Promise<{
      finished: boolean
      messageID?: string
      contentHash?: string
      reason?: "streaming" | "retry" | "no_assistant_message"
    }> => {
      // Avoid a circular import — read SessionStatus lazily.
      const { SessionStatus } = await import("./status")
      const status = SessionStatus.get(sessionID)
      if (status.type === "streaming") return { finished: false, reason: "streaming" }
      if (status.type === "retry") return { finished: false, reason: "retry" }

      let latest: Message.WithParts | undefined
      for await (const msg of Message.stream(sessionID)) {
        if (msg.info.role === "assistant") {
          // Message.stream yields newest-first per existing convention used
          // by `messages()` above (which reverses afterwards). Capture the
          // first assistant we see and break.
          latest = msg
          break
        }
      }
      if (!latest) return { finished: false, reason: "no_assistant_message" }

      // Hash concatenated text/reasoning content. Use Bun's crypto in tests
      // and node:crypto in production builds — both expose createHash.
      const { createHash } = await import("node:crypto")
      const hasher = createHash("sha256")
      for (const part of latest.parts) {
        if (part.type === "text" || part.type === "reasoning") {
          hasher.update(part.text)
        }
      }
      return {
        finished: true,
        messageID: latest.info.id,
        contentHash: hasher.digest("hex"),
      }
    },
  )

  export function* list(input?: {
    directory?: string
    roots?: boolean
    start?: number
    search?: string
    limit?: number
  }) {
    const project = Instance.project
    const conditions = [eq(SessionTable.project_id, project.id)]

    if (input?.directory) {
      conditions.push(eq(SessionTable.directory, input.directory))
    }
    if (input?.roots) {
      conditions.push(isNull(SessionTable.parent_id))
    }
    if (input?.start) {
      conditions.push(gte(SessionTable.time_updated, input.start))
    }
    if (input?.search) {
      conditions.push(like(SessionTable.title, `%${input.search}%`))
    }

    const limit = input?.limit ?? 100

    const rows = Database.use((db) =>
      db
        .select()
        .from(SessionTable)
        .where(and(...conditions))
        .orderBy(desc(SessionTable.time_updated))
        .limit(limit)
        .all(),
    )
    for (const row of rows) {
      yield fromRow(row)
    }
  }

  export function* listGlobal(input?: {
    directory?: string
    roots?: boolean
    start?: number
    cursor?: number
    search?: string
    limit?: number
    archived?: boolean
  }) {
    const conditions: SQL[] = []

    if (input?.directory) {
      conditions.push(eq(SessionTable.directory, input.directory))
    }
    if (input?.roots) {
      conditions.push(isNull(SessionTable.parent_id))
    }
    if (input?.start) {
      conditions.push(gte(SessionTable.time_updated, input.start))
    }
    if (input?.cursor) {
      conditions.push(lt(SessionTable.time_updated, input.cursor))
    }
    if (input?.search) {
      conditions.push(like(SessionTable.title, `%${input.search}%`))
    }
    if (!input?.archived) {
      conditions.push(isNull(SessionTable.time_archived))
    }

    const limit = input?.limit ?? 100

    const rows = Database.use((db) => {
      const query =
        conditions.length > 0
          ? db
              .select()
              .from(SessionTable)
              .where(and(...conditions))
          : db.select().from(SessionTable)
      return query.orderBy(desc(SessionTable.time_updated), desc(SessionTable.id)).limit(limit).all()
    })

    const ids = [...new Set(rows.map((row) => row.project_id))]
    const projects = new Map<string, ProjectInfo>()

    if (ids.length > 0) {
      const items = Database.use((db) =>
        db
          .select({ id: ProjectTable.id, name: ProjectTable.name, worktree: ProjectTable.worktree })
          .from(ProjectTable)
          .where(inArray(ProjectTable.id, ids))
          .all(),
      )
      for (const item of items) {
        projects.set(item.id, {
          id: item.id,
          name: item.name ?? undefined,
          worktree: item.worktree,
        })
      }
    }

    for (const row of rows) {
      const project = projects.get(row.project_id) ?? null
      yield { ...fromRow(row), project }
    }
  }

  export const children = fn(Identifier.schema("session"), async (parentID) => {
    const project = Instance.project
    const rows = Database.use((db) =>
      db
        .select()
        .from(SessionTable)
        .where(and(eq(SessionTable.project_id, project.id), eq(SessionTable.parent_id, parentID)))
        .all(),
    )
    return rows.map(fromRow)
  })

  // Flat list of session IDs in the subtree rooted at `sessionID`, parent
  // first then descendants. Lives here as the single source for "walk the
  // session tree" — callers that need to cancel/abort/cleanup every session
  // under a parent must use this instead of rolling their own recursion
  // (rule 8 single source, rule 9 shared abstraction). Previously duplicated
  // as private `sessionTree` helpers in engine/writer.ts and task-api/index.ts.
  export const tree = fn(Identifier.schema("session"), async (sessionID) => {
    return treeInProject({ sessionID, projectID: Instance.project.id })
  })

  export const treeInProject = fn(SessionProjectInput, async ({ sessionID, projectID }) => {
    const ids: string[] = [sessionID]
    const queue: string[] = [sessionID]
    while (queue.length > 0) {
      const next = queue.shift()!
      const direct = await childrenInProject({ parentID: next, projectID })
      for (const child of direct) {
        ids.push(child.id)
        queue.push(child.id)
      }
    }
    return ids
  })

  export const childrenInProject = fn(
    z.object({
      parentID: Identifier.schema("session"),
      projectID: z.string().min(1),
    }),
    async ({ parentID, projectID }) => {
      const rows = Database.use((db) =>
        db
          .select()
          .from(SessionTable)
          .where(and(eq(SessionTable.project_id, projectID), eq(SessionTable.parent_id, parentID)))
          .all(),
      )
      return rows.map(fromRow)
    },
  )

  async function removeSessionTree(input: { sessionID: string; projectID: string; publishDeleted: boolean }) {
    const { sessionID, projectID, publishDeleted } = input
    const session = await get(sessionID)
    if (session.projectID !== projectID) {
      throw new Error(`Session ${sessionID} belongs to project ${session.projectID}, not ${projectID}`)
    }
    for (const child of await childrenInProject({ parentID: sessionID, projectID })) {
      await removeSessionTree({ sessionID: child.id, projectID, publishDeleted })
    }
    // CASCADE delete handles messages and parts automatically
    Database.use((db) => {
      db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run()
      Database.effect(() => Database.incrementalVacuum())
      if (publishDeleted) {
        Database.effect(() =>
          Bus.publish(Event.Deleted, {
            info: session,
          }),
        )
      }
    })
  }

  export const remove = fn(Identifier.schema("session"), async (sessionID) => {
    return removeSessionTree({ sessionID, projectID: Instance.project.id, publishDeleted: true })
  })

  export const removeInProject = fn(SessionProjectInput, async ({ sessionID, projectID }) => {
    return removeSessionTree({ sessionID, projectID, publishDeleted: false })
  })

  function messageWithPersistedCreated(msg: Message.Info, timeCreated: number): Message.Info {
    return {
      ...msg,
      time: {
        ...msg.time,
        created: timeCreated,
      },
    } as Message.Info
  }

  export const updateMessage = fn(Message.Info, async (msg) => {
    let persisted = msg
    Database.use((db) => {
      const existing = db
        .select({ time_created: MessageTable.time_created })
        .from(MessageTable)
        .where(eq(MessageTable.id, msg.id))
        .get()
      persisted = messageWithPersistedCreated(msg, existing?.time_created ?? msg.time.created)
      const time_created = persisted.time.created
      const { id, sessionID, ...data } = persisted
      db.insert(MessageTable)
        .values({
          id,
          session_id: sessionID,
          time_created,
          data,
        })
        .onConflictDoUpdate({ target: MessageTable.id, set: { data } })
        .run()
      Database.effect(() =>
        Bus.publish(Message.Event.Updated, {
          info: persisted,
        }),
      )
    })
    return persisted
  })

  /**
   * Write a message row to the database without publishing a Bus event.
   * Use this when the message needs to exist in the DB (e.g. as an FK target
   * for parts) but the notification should be deferred until the message is
   * fully assembled. Follow up with `updateMessage` to publish the event.
   */
  export const saveMessage = fn(Message.Info, async (msg) => {
    let persisted = msg
    Database.use((db) => {
      const existing = db
        .select({ time_created: MessageTable.time_created })
        .from(MessageTable)
        .where(eq(MessageTable.id, msg.id))
        .get()
      persisted = messageWithPersistedCreated(msg, existing?.time_created ?? msg.time.created)
      const time_created = persisted.time.created
      const { id, sessionID, ...data } = persisted
      db.insert(MessageTable)
        .values({
          id,
          session_id: sessionID,
          time_created,
          data,
        })
        .onConflictDoUpdate({ target: MessageTable.id, set: { data } })
        .run()
    })
    return persisted
  })

  /**
   * Persist one logical message atomically.
   *
   * The message row itself must exist before parts can reference it, but
   * publishing `message.updated` before the parts are durable creates an
   * observable split-brain: listeners can see a header-only message and miss
   * the authored text if the process dies mid-write. We therefore:
   *   1. save the message row silently as the foreign-key target,
   *   2. queue the visible `message.updated` event in the same transaction,
   *   3. write every part in that same transaction,
   *   4. optionally touch the owning session before commit.
   *
   * Because the bus effects drain only after the transaction commits, any
   * observer that sees `message.updated` or `message.part.updated` is guaranteed
   * to read the fully durable message bundle from SQLite.
   */
  export const persistMessage = fn(
    z.object({
      info: Message.Info,
      parts: z.array(Message.Part),
      touchSessionID: Identifier.schema("session").optional(),
    }),
    async (input) => {
      Database.transaction(() => {
        saveMessage(input.info)
        updateMessage(input.info)
        for (const part of input.parts) {
          updatePart(part)
        }
        if (input.touchSessionID) {
          touch(input.touchSessionID)
        }
      })
      return {
        info: input.info,
        parts: input.parts,
      }
    },
  )

  export const removeMessage = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message"),
    }),
    async (input) => {
      // CASCADE delete handles parts automatically
      Database.use((db) => {
        db.delete(MessageTable)
          .where(and(eq(MessageTable.id, input.messageID), eq(MessageTable.session_id, input.sessionID)))
          .run()
        Database.effect(() =>
          Bus.publish(Message.Event.Removed, {
            sessionID: input.sessionID,
            messageID: input.messageID,
          }),
        )
      })
      return input.messageID
    },
  )

  export const removePart = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message"),
      partID: Identifier.schema("part"),
    }),
    async (input) => {
      Database.use((db) => {
        db.delete(PartTable)
          .where(and(eq(PartTable.id, input.partID), eq(PartTable.session_id, input.sessionID)))
          .run()
        Database.effect(() =>
          Bus.publish(Message.Event.PartRemoved, {
            sessionID: input.sessionID,
            messageID: input.messageID,
            partID: input.partID,
          }),
        )
      })
      return input.partID
    },
  )

  const UpdatePartInput = Message.Part

  const TOOL_STATUS_RANK: Record<string, number> = { pending: 0, running: 1, completed: 2, error: 2 }

  /** Detector for inline base64 image / pdf / audio / video data URLs inside
   *  a part's serialized data. Single source for the write-boundary guard
   *  (see specs/acceptance-attachment-store-single-source-2026-05-11.md):
   *
   *  - This is the inverse pattern of `AttachmentStore` refs
   *    (`/attachment/<projectID>/<sha>.<ext>`). Every inline-base64 producer
   *    that survived the migration must route through `AttachmentStore.write`
   *    instead of stuffing data URLs into `part.state.attachments[].url`
   *    (or `part.url`, for user file parts).
   *
   *  - rule 6.1 second branch: this is a data-integrity gate, not an
   *    LLM-decision shortcut. The producer code path is the bug; this
   *    guard surfaces the regression at the write boundary so it cannot
   *    silently bloat the DB. */
  const INLINE_BASE64_RE = /"data:[^";,]+;base64,/
  export class InlineBase64InPartError extends Error {
    constructor(
      public readonly partID: string,
      snippet: string,
    ) {
      super(
        `Session.updatePart: refusing inline base64 data URL in part ${partID}. ` +
          `Route the producer through AttachmentStore.write so part.data stores a ` +
          `/attachment/<sha>.<ext> ref instead of MB of inline bytes. ` +
          `(specs/acceptance-attachment-store-single-source-2026-05-11.md). ` +
          `Offending snippet: ${snippet}`,
      )
      this.name = "InlineBase64InPartError"
    }
  }

  export const updatePart = fn(UpdatePartInput, async (part) => {
    const { id, messageID, sessionID, ...data } = part
    // Cheap regex on the serialized string is O(N) over the part payload,
    // dominated by the JSON.stringify cost the insert below would pay
    // anyway. Triggers before the row touches SQLite — keeps the DB clean.
    const serialized = JSON.stringify(data)
    const match = INLINE_BASE64_RE.exec(serialized)
    if (match) {
      const start = Math.max(0, match.index - 40)
      const snippet = serialized.slice(start, match.index + 80).replace(/\s+/g, " ")
      throw new InlineBase64InPartError(id, snippet)
    }
    const time = Date.now()
    const publishPartUpdated = () =>
      Bus.publish(Message.Event.PartUpdated, {
        part,
      })
    const publishAfterCommit = Database.hasActiveContext()
    let wrotePart = false
    Database.use((db) => {
      // Tool status monotonicity: never regress a tool part's status
      if (part.type === "tool" && part.state?.status) {
        const existing = db.select({ data: PartTable.data }).from(PartTable).where(eq(PartTable.id, id)).get()
        if (existing?.data) {
          const prev = existing.data as any
          if (prev.type === "tool" && prev.state?.status) {
            const oldRank = TOOL_STATUS_RANK[prev.state.status] ?? 0
            const newRank = TOOL_STATUS_RANK[part.state.status] ?? 0
            if (newRank < oldRank) return
          }
        }
      }
      db.insert(PartTable)
        .values({
          id,
          message_id: messageID,
          session_id: sessionID,
          time_created: time,
          data,
        })
        .onConflictDoUpdate({ target: PartTable.id, set: { data } })
        .run()
      wrotePart = true
      if (publishAfterCommit) Database.effect(publishPartUpdated)
    })
    // SSE (Server-Sent Events) stream deltas depend on the part-created
    // event already being visible to live subscribers. Outside an existing
    // DB transaction, publish and await that event before callers emit
    // message.part.delta. Inside a transaction, keep the post-commit effect
    // boundary so observers never see uncommitted parts.
    if (wrotePart && !publishAfterCommit) await publishPartUpdated()
    return part
  })

  // updatePartDelta is a pure Bus publish. Deltas are ephemeral by contract —
  // the protocol bridge (task-message-protocol-bridge.ts:bridgeDelta) routes
  // them through ProtocolStore.dispatchEphemeral with no sequence and no
  // replay, and every streaming caller (session-hooks, engine/runtime,
  // session/processor) already maintains an in-memory accumulator and
  // persists the complete Part via updatePart at each natural boundary
  // (tool-call, reasoning-end, session.idle). Writing deltas to PartTable
  // would therefore produce state that is overwritten at the next boundary
  // and never observed — pure write amplification. Under parallel goal
  // execution this amplification used to starve the SQLite write lock and
  // stall the main event loop, which read as "overlay freezing".
  export const updatePartDelta = fn(
    z.object({
      sessionID: z.string(),
      messageID: z.string(),
      partID: z.string(),
      field: z.string(),
      delta: z.string(),
    }),
    async (input) => {
      Bus.publish(Message.Event.PartDelta, input)
    },
  )

  export const getUsage = fn(
    z.object({
      model: z.custom<Provider.Model>(),
      usage: z.custom<LanguageModelUsage>(),
      metadata: z.custom<ProviderMetadata>().optional(),
    }),
    (input) => {
      const safe = (value: number) => {
        if (!Number.isFinite(value)) return 0
        return value
      }
      const inputTokens = safe(input.usage.inputTokens ?? 0)
      const outputTokens = safe(input.usage.outputTokens ?? 0)
      const reasoningTokens = safe(input.usage.reasoningTokens ?? 0)

      const cacheReadInputTokens = safe(input.usage.cachedInputTokens ?? 0)
      const cacheWriteInputTokens = safe(
        (input.metadata?.["anthropic"]?.["cacheCreationInputTokens"] ??
          (input.metadata?.["bedrock"] as any)?.["usage"]?.["cacheWriteInputTokens"] ??
          (input.metadata?.["venice"] as any)?.["usage"]?.["cacheCreationInputTokens"] ??
          0) as number,
      )

      // [observability/phase-0] When a provider reports cache hits (read>0) but we
      // extract 0 write tokens, the provider either (a) genuinely doesn't expose
      // a "creation" field (OpenAI-style servers manage cache server-side and only
      // surface read), or (b) nests the field under a provider key we haven't
      // added above. Log the metadata shape once per (provider, model) combo so
      // the fix (or documented "this provider has no write signal") is
      // evidence-based — not spammed per request.
      if (cacheReadInputTokens > 0 && cacheWriteInputTokens === 0 && input.metadata) {
        const dedupeKey = `${input.model.providerID}/${input.model.id}`
        if (!cacheWriteMissLogged.has(dedupeKey)) {
          cacheWriteMissLogged.add(dedupeKey)
          const providerKeys = Object.keys(input.metadata)
          const snapshot = providerKeys.reduce<Record<string, unknown>>((acc, key) => {
            const value = (input.metadata as Record<string, unknown>)[key]
            acc[key] = value && typeof value === "object" ? { keys: Object.keys(value as object) } : typeof value
            return acc
          }, {})
          log.info("cache_write extraction miss", {
            providerID: input.model.providerID,
            modelID: input.model.id,
            npm: input.model.api.npm,
            cacheReadInputTokens,
            metadataProviderKeys: providerKeys,
            metadataShape: snapshot,
            usageKeys: Object.keys(input.usage as object),
          })
        }
      }

      // OpenRouter provides inputTokens as the total count of input tokens (including cached).
      // AFAIK other providers (OpenRouter/OpenAI/Gemini etc.) do it the same way e.g. vercel/ai#8794 (comment)
      // Anthropic does it differently though - inputTokens doesn't include cached tokens.
      // It looks like OpenCorvus's cost calculation assumes all providers return inputTokens the same way Anthropic does (I'm guessing getUsage logic was originally implemented with anthropic), so it's causing incorrect cost calculation for OpenRouter and others.
      const excludesCachedTokens = !!(input.metadata?.["anthropic"] || input.metadata?.["bedrock"])
      const adjustedInputTokens = safe(
        excludesCachedTokens ? inputTokens : inputTokens - cacheReadInputTokens - cacheWriteInputTokens,
      )

      const total = iife(() => {
        // Anthropic doesn't provide total_tokens, also ai sdk will vastly undercount if we
        // don't compute from components
        if (
          input.model.api.npm === "@ai-sdk/anthropic" ||
          input.model.api.npm === "@ai-sdk/amazon-bedrock" ||
          input.model.api.npm === "@ai-sdk/google-vertex/anthropic"
        ) {
          return adjustedInputTokens + outputTokens + reasoningTokens + cacheReadInputTokens + cacheWriteInputTokens
        }
        return safe(
          input.usage.totalTokens ??
            adjustedInputTokens + outputTokens + reasoningTokens + cacheReadInputTokens + cacheWriteInputTokens,
        )
      })

      const tokens = {
        total,
        input: adjustedInputTokens,
        output: outputTokens,
        reasoning: reasoningTokens,
        cache: {
          write: cacheWriteInputTokens,
          read: cacheReadInputTokens,
        },
      }

      const costInfo =
        input.model.cost?.experimentalOver200K && tokens.input + tokens.cache.read > 200_000
          ? input.model.cost.experimentalOver200K
          : input.model.cost
      return {
        cost: safe(
          new Decimal(0)
            .add(new Decimal(tokens.input).mul(costInfo?.input ?? 0).div(1_000_000))
            .add(new Decimal(tokens.output).mul(costInfo?.output ?? 0).div(1_000_000))
            .add(new Decimal(tokens.cache.read).mul(costInfo?.cache?.read ?? 0).div(1_000_000))
            .add(new Decimal(tokens.cache.write).mul(costInfo?.cache?.write ?? 0).div(1_000_000))
            // models.dev does not expose a separate reasoning rate; charge reasoning
            // tokens at the output rate.
            .add(new Decimal(tokens.reasoning).mul(costInfo?.output ?? 0).div(1_000_000))
            .toNumber(),
        ),
        tokens,
      }
    },
  )

  export class BusyError extends Error {
    constructor(public readonly sessionID: string) {
      super(`Session ${sessionID} is busy`)
    }
  }

  export const initialize = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      modelID: z.string(),
      providerID: z.string(),
      messageID: Identifier.schema("message"),
    }),
    async (input) => {
      const { SessionPrompt } = await import("./prompt")
      await SessionPrompt.command({
        sessionID: input.sessionID,
        messageID: input.messageID,
        model: input.providerID + "/" + input.modelID,
        command: Command.Default.INIT,
        arguments: "",
      })
    },
  )
}

export { Message } from "./message"
export { Todo } from "./todo"
export { SessionStatus } from "./status"
export { SessionWake } from "./wake"
