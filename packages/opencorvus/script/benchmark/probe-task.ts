import { Database } from "bun:sqlite"

const db = new Database("C:/Users/chuan/.local/share/opencorvus/opencorvus.db", { readonly: true })
const t = "tsk_dd2e4f471001WMxg1Oe23Pu3bA"

console.log("--- task ---")
const row = db
  .query("SELECT id,title,executor,request,time_created,time_updated FROM engine_task WHERE id=?")
  .get(t) as Record<string, unknown> | undefined
console.log(row)

console.log("\n--- workflow steps ---")
for (const r of db
  .query(
    "SELECT type, source, emitted_at, json_extract(payload,'$.stepID') AS step, json_extract(payload,'$.status') AS s, json_extract(payload,'$.summary') AS sum FROM protocol_event WHERE task_id=? AND type='workflow.step.updated' ORDER BY emitted_at",
  )
  .all(t)) {
  console.log(r)
}

console.log("\n--- last 40 protocol events ---")
for (const r of db
  .query("SELECT type, source, emitted_at FROM protocol_event WHERE task_id=? ORDER BY emitted_at DESC LIMIT 40")
  .all(t)) {
  console.log(r)
}

console.log("\n--- key non-noise events around build failure (workflow/build/integrity) ---")
for (const r of db
  .query(
    "SELECT type, source, emitted_at, payload FROM protocol_event WHERE task_id=? AND (type LIKE 'workflow%' OR type LIKE 'integrity%' OR type LIKE 'build%' OR type LIKE 'architect%' OR type LIKE 'goal%' OR type='task.updated') ORDER BY emitted_at",
  )
  .all(t) as Array<{ type: string; source: string; emitted_at: number; payload: string }>) {
  let payload: unknown = r.payload
  try {
    payload = JSON.parse(r.payload)
  } catch {}
  console.log({ type: r.type, source: r.source, t: r.emitted_at, payload })
}
