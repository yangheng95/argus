import { Database } from "bun:sqlite"

const TASK = "tsk_ddc67008f001pRQAXurqfkwPtT"
const DB = "D:/myhexin-local/argus/packages/overlay/dist/opencorvus-overlay-windows-x64/.opencorvus/opencorvus.db"
const db = new Database(DB, { readonly: true })

const arts = db
  .query<{ id: string; payload: string; time_created: number }, []>(
    `SELECT id, payload, time_created FROM engine_artifact
   WHERE task_id = '${TASK}' AND kind = 'orchestrator-stream-error'
   ORDER BY time_created`,
  )
  .all()

console.log(`orchestrator-stream-error artifacts: ${arts.length}`)
for (let i = 0; i < arts.length; i++) {
  const a = arts[i]
  console.log(`\n--- #${i + 1} ${a.id} t=${new Date(a.time_created).toISOString()} ---`)
  let parsed: any = a.payload
  try {
    parsed = JSON.parse(a.payload)
  } catch {}
  console.log(typeof parsed === "string" ? parsed.slice(0, 2500) : JSON.stringify(parsed, null, 2).slice(0, 2500))
}

console.log("\n\n===== orchestrator session timeline =====")
const orchSes = db
  .query<{ id: string; time_created: number; time_updated: number }, []>(
    `WITH RECURSIVE st(id) AS (
     SELECT session_id FROM engine_task WHERE id='${TASK}'
     UNION ALL
     SELECT s.id FROM session s JOIN st ON s.parent_id = st.id
   )
   SELECT s.id, s.time_created, s.time_updated FROM session s JOIN st ON s.id = st.id
   WHERE s.kind='orchestrator' ORDER BY s.time_created`,
  )
  .all()
for (const s of orchSes) {
  console.log(
    `${s.id}  start=${new Date(s.time_created).toISOString()}  end=${new Date(s.time_updated).toISOString()}  alive=${((s.time_updated - s.time_created) / 1000).toFixed(1)}s`,
  )
}

console.log("\n\n===== first orchestrator-session messages =====")
const m = db
  .query<{ id: string; session_id: string; data: string; time_created: number }, []>(
    `WITH RECURSIVE st(id) AS (
     SELECT session_id FROM engine_task WHERE id='${TASK}'
     UNION ALL
     SELECT s.id FROM session s JOIN st ON s.parent_id = st.id
   ),
   orch(id) AS (
     SELECT s.id FROM session s JOIN st ON s.id = st.id WHERE s.kind='orchestrator' AND s.time_created < 1777519968000
   )
   SELECT m.id, m.session_id, m.data, m.time_created FROM message m JOIN orch ON m.session_id = orch.id
   ORDER BY m.time_created`,
  )
  .all()
for (const row of m) {
  let d: any = {}
  try {
    d = JSON.parse(row.data)
  } catch {}
  console.log(
    `${row.id} ses=${row.session_id} role=${d.role} agent=${d.agent} finish=${d.finish} t=${new Date(row.time_created).toISOString()}`,
  )
  if (d.error || d.errorMessage) {
    console.log(
      `  error: ${typeof d.error === "string" ? d.error.slice(0, 600) : JSON.stringify(d.error).slice(0, 600)}`,
    )
  }
}
