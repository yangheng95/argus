import { Database } from "bun:sqlite"
import { requiredEnv } from "./inspect-env"

const TASK = requiredEnv("TASK_ID")
const G3 = requiredEnv("GOAL_3_ID")
const G4 = requiredEnv("GOAL_4_ID")
const G3_SES = requiredEnv("GOAL_3_SESSION_ID")
const G4_SES = requiredEnv("GOAL_4_SESSION_ID")
const DB = requiredEnv("OPENCORVUS_DB")
const db = new Database(DB, { readonly: true })

console.log("===== G3 (frontend) full message timeline =====")
const g3msgs = db
  .query<
    { id: string; data: string; time_created: number },
    []
  >(`SELECT id, data, time_created FROM message WHERE session_id='${G3_SES}' ORDER BY time_created`)
  .all()
let prevT = 0
for (const m of g3msgs) {
  let d: any = {}
  try {
    d = JSON.parse(m.data)
  } catch {}
  const gap = prevT > 0 ? ((m.time_created - prevT) / 1000).toFixed(1) + "s" : "—"
  const errStr = d.error
    ? `  ERR=${typeof d.error === "string" ? d.error.slice(0, 200) : JSON.stringify(d.error).slice(0, 200)}`
    : ""
  console.log(
    `+${gap.padStart(8)}  ${new Date(m.time_created).toISOString()}  ${m.id}  role=${d.role}  finish=${d.finish ?? "—"}  toks=${d.tokens?.total ?? "—"}${errStr}`,
  )
  prevT = m.time_created
}

console.log("\n\n===== G4 (backend) full message timeline =====")
const g4msgs = db
  .query<
    { id: string; data: string; time_created: number },
    []
  >(`SELECT id, data, time_created FROM message WHERE session_id='${G4_SES}' ORDER BY time_created`)
  .all()
prevT = 0
for (const m of g4msgs) {
  let d: any = {}
  try {
    d = JSON.parse(m.data)
  } catch {}
  const gap = prevT > 0 ? ((m.time_created - prevT) / 1000).toFixed(1) + "s" : "—"
  const errStr = d.error
    ? `  ERR=${typeof d.error === "string" ? d.error.slice(0, 200) : JSON.stringify(d.error).slice(0, 200)}`
    : ""
  console.log(
    `+${gap.padStart(8)}  ${new Date(m.time_created).toISOString()}  ${m.id}  role=${d.role}  finish=${d.finish ?? "—"}  toks=${d.tokens?.total ?? "—"}${errStr}`,
  )
  prevT = m.time_created
}

console.log("\n\n===== goal_run_attempt rows for this task =====")
const attempts = db
  .query<
    { id: string; goal_run_id: string; label: string; payload: string; time_created: number; time_updated: number },
    []
  >(`SELECT id, goal_run_id, label, payload, time_created, time_updated FROM engine_artifact WHERE task_id='${TASK}' AND kind='goal_run_attempt' ORDER BY time_created`)
  .all()
for (const a of attempts) {
  let p: any = {}
  try {
    p = JSON.parse(a.payload)
  } catch {}
  console.log(
    `${a.id}  glr=${a.goal_run_id}  label=${a.label}  goal=${p.goal_id}  status=${p.status}  block=${p.blocking_reason ?? "-"}  err=${p.error ?? "-"}  t_created=${new Date(a.time_created).toISOString()}  t_updated=${new Date(a.time_updated).toISOString()}`,
  )
}

console.log("\n\n===== run rows =====")
const runs = db
  .query<
    { id: string; run_id: string; label: string; payload: string; time_created: number; time_updated: number },
    []
  >(`SELECT id, run_id, label, payload, time_created, time_updated FROM engine_artifact WHERE task_id='${TASK}' AND kind='run' ORDER BY time_created`)
  .all()
for (const r of runs) {
  let p: any = {}
  try {
    p = JSON.parse(r.payload)
  } catch {}
  console.log(
    `${r.id}  run=${r.run_id}  label=${r.label}  status=${p.status}  phase=${p.phase}  blocking_reason=${p.blocking_reason ?? "-"}  err=${p.error ?? "-"}  t=${new Date(r.time_updated).toISOString()}`,
  )
}

console.log("\n\n===== Last 8 protocol events for each goal =====")
for (const [name, gid] of [
  ["G3", G3],
  ["G4", G4],
] as const) {
  console.log(`\n--- ${name} (${gid}) ---`)
  const evs = db
    .query<
      { type: string; source: string; emitted_at: number; payload: string },
      []
    >(`SELECT type, source, emitted_at, payload FROM protocol_event WHERE task_id='${TASK}' AND payload LIKE '%${gid}%' ORDER BY emitted_at DESC LIMIT 8`)
    .all()
  for (const e of evs) {
    console.log(`  ${new Date(e.emitted_at).toISOString()}  ${e.type}  ${e.source}  ${e.payload.slice(0, 200)}`)
  }
}

console.log("\n\n===== events ANYWHERE since 03:32:17 (last 50) =====")
const since = 1777519937065
const recent = db
  .query<
    { type: string; source: string; emitted_at: number; payload: string },
    []
  >(`SELECT type, source, emitted_at, payload FROM protocol_event WHERE task_id='${TASK}' AND emitted_at > ${since} ORDER BY emitted_at DESC LIMIT 50`)
  .all()
for (const e of recent) {
  console.log(`  ${new Date(e.emitted_at).toISOString()}  ${e.type}  ${e.source}`)
}

console.log("\n\n===== count of session.bridge events per session, since 03:32 =====")
const bridgeCounts = db
  .query<{ session_id: string; n: number; first: number; last: number }, []>(
    `WITH RECURSIVE st(id) AS (
     SELECT session_id FROM engine_task WHERE id='${TASK}'
     UNION ALL
     SELECT s.id FROM session s JOIN st ON s.parent_id = st.id
   )
   SELECT json_extract(payload,'$.sessionID') AS session_id,
          COUNT(*) AS n,
          MIN(emitted_at) AS first,
          MAX(emitted_at) AS last
   FROM protocol_event
   WHERE task_id='${TASK}' AND source='session.bridge' AND emitted_at > ${since - 5 * 60 * 1000}
   GROUP BY session_id
   ORDER BY last DESC`,
  )
  .all()
for (const b of bridgeCounts) {
  console.log(
    `  ses=${b.session_id}  n=${b.n}  first=${new Date(b.first).toISOString()}  last=${new Date(b.last).toISOString()}`,
  )
}

console.log("\n\n===== G3 last 18 parts (with text excerpts) =====")
const g3parts = db
  .query<
    { id: string; message_id: string; data: string; time_created: number },
    []
  >(`SELECT id, message_id, data, time_created FROM part WHERE session_id='${G3_SES}' ORDER BY time_created DESC LIMIT 18`)
  .all()
for (const p of g3parts) {
  let d: any = {}
  try {
    d = JSON.parse(p.data)
  } catch {}
  const text = (d.text ?? "").toString().slice(0, 100).replace(/\n/g, " ")
  console.log(
    `  ${new Date(p.time_created).toISOString()}  type=${d.type}  tool=${d.tool ?? "-"}  status=${d.state?.status ?? "-"}  title="${(d.state?.title ?? "").toString().slice(0, 60)}"  text="${text}"`,
  )
}

console.log("\n\n===== G3 most recent assistant message error / fields =====")
const g3last = db
  .query<
    { id: string; data: string; time_created: number },
    []
  >(`SELECT id, data, time_created FROM message WHERE session_id='${G3_SES}' AND json_extract(data,'$.role')='assistant' ORDER BY time_created DESC LIMIT 3`)
  .all()
for (const m of g3last) {
  let d: any = {}
  try {
    d = JSON.parse(m.data)
  } catch {}
  console.log(`---- ${m.id} t=${new Date(m.time_created).toISOString()} ----`)
  console.log(
    `  finish=${d.finish ?? "—"}  err=${JSON.stringify(d.error ?? null).slice(0, 400)}  tokens.total=${d.tokens?.total ?? "—"}`,
  )
  console.log(`  modelID=${d.modelID}  providerID=${d.providerID}`)
}
