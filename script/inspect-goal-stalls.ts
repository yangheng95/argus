import { Database } from "bun:sqlite"
import { requiredEnv, requiredEnvList } from "./inspect-env"

const TASK = requiredEnv("TASK_ID")
const TARGET_GOAL_IDS = new Set(requiredEnvList("GOAL_IDS"))
const DETAIL_GOAL_ID = requiredEnv("DETAIL_GOAL_ID")
const DB = requiredEnv("OPENCORVUS_DB")
const db = new Database(DB, { readonly: true })

const buildSessions = db
  .query<{ id: string; goal_id: string; time_created: number; time_updated: number }, []>(
    `WITH RECURSIVE st(id) AS (
     SELECT session_id FROM engine_task WHERE id='${TASK}'
     UNION ALL
     SELECT s.id FROM session s JOIN st ON s.parent_id = st.id
   )
   SELECT s.id, s.goal_id, s.time_created, s.time_updated FROM session s JOIN st ON s.id = st.id WHERE s.kind='build'
   ORDER BY s.time_created`,
  )
  .all()

console.log("===== build sessions =====")
for (const b of buildSessions) {
  console.log(
    `${b.id}  goal=${b.goal_id}  start=${new Date(b.time_created).toISOString()}  last=${new Date(b.time_updated).toISOString()}  age=${((b.time_updated - b.time_created) / 1000).toFixed(1)}s`,
  )
}

for (const b of buildSessions) {
  if (!TARGET_GOAL_IDS.has(b.goal_id)) continue
  console.log(`\n\n===== goal=${b.goal_id} session=${b.id} — last 12 messages =====`)
  const msgs = db
    .query<
      { id: string; data: string; time_created: number },
      []
    >(`SELECT id, data, time_created FROM message WHERE session_id='${b.id}' ORDER BY time_created DESC LIMIT 12`)
    .all()
  for (const m of msgs) {
    let d: any = {}
    try {
      d = JSON.parse(m.data)
    } catch {}
    const errStr = d.error ? (typeof d.error === "string" ? d.error : JSON.stringify(d.error)) : ""
    console.log(
      `${m.id}  role=${d.role}  agent=${d.agent}  finish=${d.finish}  tokens=${d.tokens?.total}  t=${new Date(m.time_created).toISOString()}${errStr ? "  ERR=" + errStr.slice(0, 250) : ""}`,
    )
  }
  console.log(`\n----- last 14 parts -----`)
  const parts = db
    .query<
      { id: string; message_id: string; data: string; time_created: number },
      []
    >(`SELECT id, message_id, data, time_created FROM part WHERE session_id='${b.id}' ORDER BY time_created DESC LIMIT 14`)
    .all()
  for (const p of parts) {
    let d: any = {}
    try {
      d = JSON.parse(p.data)
    } catch {}
    const tool = d.tool ?? ""
    const status = d.state?.status ?? ""
    const title = (d.state?.title ?? "").toString().slice(0, 80)
    const text = (d.text ?? "").toString().slice(0, 80)
    console.log(
      `${p.id}  msg=${p.message_id}  type=${d.type}  tool=${tool}  status=${status}  title="${title}"  text="${text}"  t=${new Date(p.time_created).toISOString()}`,
    )
  }
}

console.log("\n\n===== last assistant build msg per goal — full payload (first 3000) =====")
for (const b of buildSessions) {
  if (b.goal_id !== DETAIL_GOAL_ID) continue
  const last = db
    .query<
      { id: string; data: string; time_created: number },
      []
    >(`SELECT id, data, time_created FROM message WHERE session_id='${b.id}' AND json_extract(data,'$.role')='assistant' ORDER BY time_created DESC LIMIT 1`)
    .all()
  for (const m of last) {
    console.log(`---- ${m.id} t=${new Date(m.time_created).toISOString()} ----`)
    let d: any = {}
    try {
      d = JSON.parse(m.data)
    } catch {}
    console.log(JSON.stringify(d, null, 2).slice(0, 3000))
  }
  console.log("\n---- last pending tool parts (status != completed) ----")
  const pendingParts = db
    .query<
      { id: string; data: string; time_created: number },
      []
    >(`SELECT id, data, time_created FROM part WHERE session_id='${b.id}' AND json_extract(data,'$.type')='tool' AND coalesce(json_extract(data,'$.state.status'),'') != 'completed' ORDER BY time_created DESC LIMIT 6`)
    .all()
  for (const p of pendingParts) {
    let d: any = {}
    try {
      d = JSON.parse(p.data)
    } catch {}
    console.log(
      `${p.id}  tool=${d.tool}  status=${d.state?.status}  title="${(d.state?.title ?? "").toString().slice(0, 120)}"  t=${new Date(p.time_created).toISOString()}`,
    )
    if (d.state?.input) console.log(`  input: ${JSON.stringify(d.state.input).slice(0, 600)}`)
    if (d.state?.error)
      console.log(
        `  error: ${typeof d.state.error === "string" ? d.state.error.slice(0, 600) : JSON.stringify(d.state.error).slice(0, 600)}`,
      )
  }
}

console.log("\n\n===== integrity verdict events for this task =====")
const integrityArts = db
  .query<
    { id: string; payload: string; time_created: number; label: string },
    []
  >(`SELECT id, payload, time_created, label FROM engine_artifact WHERE task_id='${TASK}' AND kind='integrity_attempt' ORDER BY time_created`)
  .all()
for (const a of integrityArts) {
  console.log(`---- ${a.id} (${a.label}) t=${new Date(a.time_created).toISOString()} ----`)
  let p: any = {}
  try {
    p = JSON.parse(a.payload)
  } catch {}
  console.log(JSON.stringify(p, null, 2).slice(0, 1200))
}
