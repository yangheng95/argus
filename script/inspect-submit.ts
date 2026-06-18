import { Database } from "bun:sqlite"
import { requiredEnv } from "./inspect-env"

const ARCH_SES = requiredEnv("ARCHITECT_SESSION_ID")
const DB = requiredEnv("OPENCORVUS_DB")
const db = new Database(DB, { readonly: true })

const submits = db
  .query<
    { id: string; data: string; time_created: number },
    []
  >(`SELECT id, data, time_created FROM part WHERE session_id = '${ARCH_SES}' AND json_extract(data,'$.tool') = 'submit_architect' AND json_extract(data,'$.type')='tool' ORDER BY time_created`)
  .all()

console.log(`submit_architect calls: ${submits.length}`)
for (let i = 0; i < submits.length; i++) {
  const s = submits[i]
  const data = JSON.parse(s.data)
  const state = data?.state ?? {}
  const out = state.output ?? state.error ?? state.result
  const inp = state.input
  console.log(`\n--- #${i + 1}  part=${s.id}  t=${new Date(s.time_created).toISOString()}  status=${state.status} ---`)
  console.log("INPUT:")
  console.log(typeof inp === "string" ? inp.slice(0, 1500) : JSON.stringify(inp, null, 2).slice(0, 1500))
  console.log("OUTPUT:")
  if (typeof out === "string") {
    console.log(out.slice(0, 2500))
  } else {
    console.log(JSON.stringify(out, null, 2).slice(0, 2500))
  }
}

console.log("\n\n===== last register_goal payload =====")
const rg = db
  .query<
    { data: string },
    []
  >(`SELECT data FROM part WHERE session_id = '${ARCH_SES}' AND json_extract(data,'$.tool') = 'register_goal' AND json_extract(data,'$.type')='tool' ORDER BY time_created DESC LIMIT 3`)
  .all()
for (const r of rg) {
  const d = JSON.parse(r.data)
  console.log("input:", JSON.stringify(d.state?.input, null, 2).slice(0, 1500))
  console.log("output:", JSON.stringify(d.state?.output, null, 2).slice(0, 1500))
  console.log("---")
}
