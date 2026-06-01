import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { randomBytes } from "node:crypto"
import { Instance } from "@/project/instance"
import { ensureMissionSession, findExistingMissionSession, listMissionSessions } from "@/mission/session"
import { MissionID } from "@/mission/schema"
import { SessionWake } from "@/session/wake"

function newMissionID(): string {
  return randomBytes(8).toString("hex")
}

const MissionWakeInput = z.object({
  missionID: MissionID.optional(),
  text: z.string().min(1).max(32_000),
  title: z.string().min(1).max(120).optional(),
})

const MissionWakeResult = z.object({
  missionID: MissionID,
  sessionID: z.string(),
  created: z.boolean(),
})

const MissionRecord = z.object({
  missionID: MissionID,
  sessionID: z.string(),
  title: z.string(),
  directory: z.string(),
  created: z.number(),
  updated: z.number(),
  archived: z.number().optional(),
})

const MissionListQuery = z
  .object({
    directory: z.string().optional(),
    search: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    cursorUpdated: z.coerce.number().optional(),
    cursorSessionID: z.string().optional(),
    archived: z.coerce.boolean().optional(),
  })
  .refine((query) => (query.cursorUpdated === undefined) === (query.cursorSessionID === undefined), {
    message: "cursorUpdated and cursorSessionID must be provided together",
    path: ["cursorUpdated"],
  })

export function MissionRoutes() {
  return new Hono().get(
    "/",
    describeRoute({
      summary: "List Missions",
      description:
        "List Mission records for the current project. Each record is backed by " +
        'exactly one kind="mission" session and can be opened through the session ' +
        "conversation/event routes.",
      operationId: "mission.list",
      responses: {
        200: {
          description: "Mission records",
          content: { "application/json": { schema: resolver(MissionRecord.array()) } },
        },
      },
    }),
    validator("query", MissionListQuery),
    async (c) => {
      const query = c.req.valid("query")
      const records: z.infer<typeof MissionRecord>[] = []
      for await (const session of listMissionSessions({
        directory: query.directory,
        search: query.search,
        limit: query.limit,
        cursorUpdated: query.cursorUpdated,
        cursorSessionID: query.cursorSessionID,
        archived: query.archived,
      })) {
        records.push(
          MissionRecord.parse({
            missionID: session.missionID,
            sessionID: session.id,
            title: session.title,
            directory: session.directory,
            created: session.time.created,
            updated: session.time.updated,
            archived: session.time.archived,
          }),
        )
      }
      return c.json(records)
    },
  ).post(
    "/wake",
    describeRoute({
      summary: "Wake the Mission agent",
      description:
        "Start (or resume) a Mission agent session and inject a user prompt. " +
        "Omit `missionID` to start a new mission; supply it to resume an existing one. " +
        "The route is idempotent for (project, missionID) — exactly one mission " +
        "session is keyed per mission.",
      operationId: "mission.wake",
      responses: {
        200: {
          description: "Mission wake accepted",
          content: { "application/json": { schema: resolver(MissionWakeResult) } },
        },
      },
    }),
    validator("json", MissionWakeInput),
    async (c) => {
      const input = c.req.valid("json")
      const missionID = input.missionID ?? newMissionID()
      // Snapshot existence BEFORE ensureMissionSession so the response
      // distinguishes "started" from "resumed". The lookup and the ensure
      // call both go through the same in-process lock on missionID, so they
      // observe the same state for any single wake call.
      const existing = findExistingMissionSession(missionID)
      const session = await ensureMissionSession({
        missionID,
        defaultCwd: Instance.directory,
      })
      await SessionWake.wake({
        sessionID: session.id,
        prompt: input.text,
        agent: "mission",
      })
      return c.json(
        MissionWakeResult.parse({
          missionID,
          sessionID: session.id,
          created: !existing,
        }),
      )
    },
  )
}
