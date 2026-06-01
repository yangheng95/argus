import z from "zod"

// Mission identifier shape. It matches mission_state's path guard so
// `.opencorvus/runtime/mission/<missionID>/` remains a single valid namespace.
export const MissionID = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, "missionID must be lowercase alphanumerics and hyphens only")

export type MissionID = z.infer<typeof MissionID>
