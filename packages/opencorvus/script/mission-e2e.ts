/**
 * Scratch: end-to-end smoke test of the Mission agent against the superchart
 * demo project, using the REAL environment (real auth, real model
 * config, real DB). Faithful to the production wake path (mission session +
 * agent="mission" user message + SessionPrompt.loop) but AWAITS the loop instead
 * of fire-and-forget so we can observe one full turn. Intake-only goal — no dispatch.
 *
 * DB inspection uses a SEPARATE raw readonly bun:sqlite connection because
 * Database.use() hands back a drizzle ORM object, not a raw query() handle.
 *
 * Delete after use.
 */
import { Database as RawSqlite } from "bun:sqlite"
import { Instance } from "@/project/instance"
import { ensureMissionSession } from "@/mission/session"
import { Session } from "@/session"
import { SessionContext } from "@/session/context"
import { SessionPrompt } from "@/session/prompt"
import { Identifier } from "@/id/id"
import { resolveAgentModelRef } from "@/agent/model"
import { Database } from "@/storage/db"
import { Log } from "@/util/log"
import fs from "node:fs/promises"
import path from "node:path"

Log.init({ print: false })

const PROJECT = "D:\\myhexin-local\\demos\\superchart"
const MISSION_ID = "e2e-smoke-" + Date.now().toString(36)
const PROMPT = [
  "This is an end-to-end SMOKE TEST of the Mission agent. Scope for THIS wake only:",
  "1. Read `site-prd.md` in the project root to understand the goal.",
  "2. Write a concise mission contract to frontier.md: objective (one sentence), in-scope, out-of-scope, hard constraints, and the acceptance bar.",
  "3. Write a 3-5 phase high-level acceptance roadmap to notes.md.",
  "4. Write handoff.md for the next wake.",
  "Do NOT dispatch any engine_tasks this wake. Do NOT ask clarifying questions — make reasonable assumptions and record them in notes.md.",
  "When done, reply to me in plain language with the objective and the numbered phase list.",
].join("\n")

function ts(s: string) {
  return new Date().toISOString().slice(11, 19) + " " + s
}

await Instance.provide({
  directory: PROJECT,
  fn: async () => {
    console.log(ts(`Instance: project=${Instance.project.id} worktree=${Instance.worktree}`))
    console.log(ts(`           directory=${Instance.directory}`))

    const session = await ensureMissionSession({ missionID: MISSION_ID, defaultCwd: Instance.directory })
    console.log(
      ts(`Mission session: id=${session.id} kind=${session.kind} title=${session.title} missionID=${MISSION_ID}`),
    )

    // Separate readonly connection for inspection (DB file is initialised by now).
    const raw = new RawSqlite(Database.Path(), { readonly: true })
    const partsQ = raw.query(
      "SELECT id, json_extract(data,'$.type') t, json_extract(data,'$.tool') tool, " +
        "json_extract(data,'$.state.status') st, json_extract(data,'$.state.title') title, " +
        "json_extract(data,'$.text') text FROM part WHERE session_id=? ORDER BY time_created",
    )

    await SessionContext.provide(session, async () => {
      const model = await resolveAgentModelRef("mission", { sessionID: session.id })
      console.log(ts(`Resolved model for agent=mission: ${model.providerID}/${model.modelID}`))

      const msg = await Session.updateMessage({
        id: Identifier.ascending("message"),
        role: "user",
        sessionID: session.id,
        time: { created: Date.now() },
        agent: "mission",
        model,
      })
      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: msg.id,
        sessionID: session.id,
        type: "text",
        text: PROMPT,
        time: { start: Date.now(), end: Date.now() },
      })
      console.log(ts(`Injected user message ${msg.id}; starting mission loop...`))

      let done = false
      let loopErr: unknown
      const loopP = SessionPrompt.loop({ sessionID: session.id, resume_existing: false })
        .then(() => {
          done = true
        })
        .catch((e) => {
          done = true
          loopErr = e
        })

      const seen = new Set<string>()
      const deadlineMs = Date.now() + 6 * 60 * 1000
      while (!done && Date.now() < deadlineMs) {
        await Bun.sleep(2500)
        for (const p of partsQ.all(session.id) as any[]) {
          if (seen.has(p.id)) continue
          seen.add(p.id)
          if (p.t === "tool") {
            console.log(ts(`  TOOL ${p.tool} [${p.st || "-"}] ${(p.title || "").slice(0, 100)}`))
          } else if (p.t === "text" && p.text && p.text !== PROMPT) {
            console.log(ts(`  TEXT ${String(p.text).replace(/\s+/g, " ").slice(0, 220)}`))
          }
        }
      }

      if (!done) {
        console.log(ts("TIMEOUT (6m) — cancelling loop"))
        SessionPrompt.cancel(session.id)
      }
      await loopP
      if (loopErr) console.error(ts("LOOP ERROR:"), loopErr)
      console.log(ts(`Loop finished. parts observed=${seen.size}`))
    })

    // ---- Mission state files ----
    const stateDir = path.join(Instance.directory, ".opencorvus", "runtime", "mission", MISSION_ID)
    console.log("\n===== MISSION STATE FILES (" + stateDir + ") =====")
    for (const f of ["frontier.md", "tasks.md", "handoff.md", "notes.md"]) {
      const body = await fs.readFile(path.join(stateDir, f), "utf8").catch((e: any) => `<MISSING: ${e.code}>`)
      console.log(`\n----- ${f} -----\n${body}`)
    }

    // ---- Final assistant reply (all text parts except the injected prompt) ----
    const texts = raw
      .query(
        "SELECT json_extract(data,'$.text') text FROM part WHERE session_id=? AND " +
          "json_extract(data,'$.type')='text' ORDER BY time_created",
      )
      .all(session.id) as any[]
    console.log("\n===== ASSISTANT TEXT PARTS =====")
    for (const t of texts) {
      if (t.text && t.text !== PROMPT) console.log("• " + String(t.text).trim())
    }

    // ---- Verification ----
    const ver = raw
      .query(
        "SELECT kind, title, project_id, json_extract(metadata,'$.mission.id') mid, " +
          "json_extract(metadata,'$.mission.channelKey') ck FROM session WHERE id=?",
      )
      .get(session.id) as any
    const toolCounts = raw
      .query(
        "SELECT json_extract(data,'$.tool') tool, count(*) n FROM part WHERE session_id=? AND " +
          "json_extract(data,'$.type')='tool' GROUP BY tool ORDER BY n DESC",
      )
      .all(session.id) as any[]
    console.log("\n===== VERIFICATION =====")
    console.log(`session.kind                = ${ver.kind}   (expect: mission)`)
    console.log(`session.title               = ${ver.title}   (expect: Mission Control)`)
    console.log(`metadata.mission.id         = ${ver.mid}   (expect: ${MISSION_ID})`)
    console.log(`metadata.mission.channelKey = ${ver.ck}   (expect: mission:${MISSION_ID})`)
    console.log(`tool usage                  = ${toolCounts.map((t) => `${t.tool}:${t.n}`).join(", ") || "(none)"}`)

    raw.close()
  },
})

await Instance.disposeAll().catch(() => {})
Database.close()
process.exit(0)
