import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { randomBytes } from "node:crypto"
import { Instance } from "@/project/instance"
import { ensureMissionSession, findExistingMissionSession } from "@/mission/session"
import { SessionWake } from "@/session/wake"

// Mission identifier shape — must match the mission_state tool's regex
// (/^[a-z0-9-]{1,64}$/) so the per-mission worktree path
// (.opencorvus/runtime/mission/<missionID>/) stays valid. Auto-generated IDs
// use 16 lowercase hex chars; operators may also supply their own
// (e.g. "tv-replay-1").
const MissionID = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, "missionID must be lowercase alphanumerics and hyphens only")

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

export function MissionRoutes() {
  return new Hono().post(
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
