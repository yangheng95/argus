import { Database } from "bun:sqlite"
const db = new Database("C:/Users/chuan/.local/share/opencorvus/opencorvus.db", { readonly: true })
// Count deliver tool parts by status
const rows = db.query(`SELECT json_extract(data,'$.state.status') as status, COUNT(*) as cnt FROM part WHERE data LIKE '%"tool":"deliver"%' GROUP BY status`).all()
console.log("Deliver status breakdown:", rows)
// Show all distinct task sessions that have deliver parts with month
const ses = db.query(`
  SELECT m.session_id, MIN(p.time_created) as first_t, MAX(p.time_created) as last_t, COUNT(p.id) as cnt
  FROM part p JOIN message m ON m.id=p.message_id
  WHERE p.data LIKE '%"tool":"deliver"%'
  GROUP BY m.session_id
  ORDER BY last_t DESC
`).all() as Array<{session_id:string;first_t:number;last_t:number;cnt:number}>
console.log("Sessions with deliver:")
for (const s of ses) console.log(" ", s.session_id, "cnt=" + s.cnt, "last=" + new Date(s.last_t).toISOString())
console.log("total sessions:", ses.length)

// Also check engine_task history — how many tasks and how many have active run
const tasks = db.query(`SELECT id, status, active_run_id, time_created FROM engine_task ORDER BY time_created DESC LIMIT 15`).all() as Array<{id:string;status:string;active_run_id:string|null;time_created:number}>
console.log("\nRecent tasks:")
for (const t of tasks) console.log(" ", t.id, t.status, "run=" + (t.active_run_id||"-"), new Date(t.time_created).toISOString())
