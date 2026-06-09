import { ProjectGC } from "../../../project/gc"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"

export const GcCommand = cmd({
  command: "gc",
  describe: "garbage-collect stale projects (expired or orphan) and their snapshot / session_diff directories",
  builder: (yargs) =>
    yargs
      .option("apply", {
        type: "boolean",
        default: false,
        description: "actually delete; default is dry-run",
      })
      .option("max-age-days", {
        type: "number",
        default: ProjectGC.DEFAULT_EXPIRE_DAYS,
        description: "projects inactive for more than N days are expired",
      }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const days = typeof args["max-age-days"] === "number" ? args["max-age-days"] : ProjectGC.DEFAULT_EXPIRE_DAYS
      const plan = await ProjectGC.inspect({ expireAfterDays: days })
      console.log(`[plan] (max age: ${days} day${days === 1 ? "" : "s"})`)
      console.log("  expired projects           :", plan.expiredProjects.length)
      for (const p of plan.expiredProjects) {
        const ageDays = ((Date.now() - p.lastUsed) / 86_400_000).toFixed(1)
        console.log("    -", p.id, "→", p.worktree, `(idle ${ageDays}d)`)
      }
      console.log("  orphan snapshot dirs       :", plan.orphanSnapshots.length)
      for (const id of plan.orphanSnapshots) console.log("    -", id)
      console.log("  orphan session_diff dirs   :", plan.orphanSessionDiffs.length)
      for (const id of plan.orphanSessionDiffs) console.log("    -", id)

      if (!args.apply) {
        console.log()
        console.log("[dry-run] pass --apply to delete everything listed above.")
        return
      }

      const result = await ProjectGC.apply(plan)
      console.log("[applied]")
      console.log("  removed project rows      :", result.removedProjectRows)
      console.log("  removed snapshot dirs     :", result.removedSnapshotDirs)
      console.log("  removed session_diff dirs :", result.removedSessionDiffDirs)
      console.log("  vacuumed                  :", result.vacuumed)
    })
  },
})
