import z from "zod"

// Mission identifier shape. It matches mission_state's path guard before the
// ID is converted to the `.opencorvus/r/m/<mission-key2>/<mission-key6>/`
// runtime namespace.
export const MissionID = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, "missionID must be lowercase alphanumerics and hyphens only")

export type MissionID = z.infer<typeof MissionID>
