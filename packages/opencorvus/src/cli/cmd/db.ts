import type { Argv } from "yargs"
import { spawn } from "child_process"
import { Database } from "../../storage/db"
import { Database as BunDatabase } from "bun:sqlite"
import { Instance } from "../../project/instance"
import { UI } from "../ui"
import { cmd } from "./cmd"

const QueryCommand = cmd({
  command: "$0 [query]",
  describe: "open an interactive sqlite3 shell or run a query",
  builder: (yargs: Argv) => {
    return yargs
      .positional("query", {
        type: "string",
        describe: "SQL query to execute",
      })
      .option("format", {
        type: "string",
        choices: ["json", "tsv"],
        default: "tsv",
        describe: "Output format",
      })
  },
  handler: async (args: { query?: string; format: string }) => {
    const query = args.query as string | undefined
    if (query) {
      const db = new BunDatabase(Database.Path(), { readonly: true })
      try {
        const result = db.query(query).all() as Record<string, unknown>[]
        if (args.format === "json") {
          console.log(JSON.stringify(result, null, 2))
        } else if (result.length > 0) {
          const keys = Object.keys(result[0])
          console.log(keys.join("\t"))
          for (const row of result) {
            console.log(keys.map((k) => row[k]).join("\t"))
          }
        }
      } catch (err) {
        UI.error(err instanceof Error ? err.message : String(err))
        process.exit(1)
      }
      db.close()
      return
    }
    const child = spawn("sqlite3", [Database.Path()], {
      stdio: "inherit",
    })
    await new Promise((resolve) => child.on("close", resolve))
  },
})

const PathCommand = cmd({
  command: "path",
  describe: "print the database path",
  handler: () => {
    console.log(Database.Path())
  },
})

/**
 * `opencorvus db reset` — phase-6 style atomic DB + disk reset.
 *
 * Follows CLAUDE.md rule 13 (reset DB, no migrations) + specs/new-arch/16-unified-teardown.md §7-6
 * (schema-zero rebuild). Wipes:
 *   - Global SQLite db + WAL + SHM (`${Global.Path.data}/opencorvus.db*`)
 *   - Project runtime scratch under <primary>/.opencorvus/runtime/
 *   - Legacy runtime directories under <primary>/.opencorvus/
 *
 * Prompts for confirmation (--force to skip). Must dispose all in-memory
 * Instance handles first so WAL flushes cleanly; otherwise reopening
 * would error on half-released file locks on Windows.
 */
const ResetCommand = cmd({
  command: "reset",
  describe:
    "atomically wipe the global opencorvus SQLite DB and project scratch (worktrees, ownership markers, snapshots). DESTRUCTIVE — there is no undo.",
  builder: (yargs: Argv) => {
    return yargs.option("force", {
      type: "boolean",
      default: false,
      describe: "skip the confirmation prompt (non-interactive / CI).",
    })
  },
  handler: async (args: { force: boolean }) => {
    if (!args.force) {
      UI.error("opencorvus db reset is DESTRUCTIVE — wipes DB + worktrees + ownership + snapshots.")
      UI.error("Re-run with --force to proceed.")
      process.exit(1)
    }

    // CLI is invoked from the project directory; capture cwd BEFORE disposing
    // any active Instance so reset() can locate the project's scratch dirs.
    const projectDir = process.cwd()
    await Instance.disposeAll().catch(() => undefined)
    const results = await Database.reset(projectDir)
    for (const r of results) {
      console.log(`${r.ok ? "✓" : "✗"} ${r.label}: ${r.path}${r.ok ? "" : ` (${r.error})`}`)
    }
    console.log("")
    console.log("opencorvus db reset complete. Next process start will rebuild schema from DDL.")
  },
})

export const DbCommand = cmd({
  command: "db",
  describe: "database tools",
  builder: (yargs: Argv) => {
    return yargs.command(QueryCommand).command(PathCommand).command(ResetCommand).demandCommand()
  },
  handler: () => {},
})
