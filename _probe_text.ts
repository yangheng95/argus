import { Database } from "bun:sqlite";

const TASK_ID = "tsk_da1472b29001nyI642DQZ6w1g5";
const db = new Database("C:/Users/hengu/.local/share/opencorvus/opencorvus.db", { readonly: true });

// Search part.updated payloads for any with Chinese text content
const rows = db.query(`
  SELECT payload FROM protocol_event
  WHERE task_id = ? AND type IN ('message.part.updated','message.part.delta')
  ORDER BY emitted_at ASC
`).all(TASK_ID) as any[];

let matchCount = 0;
for (const r of rows) {
  try {
    const p = JSON.parse(r.payload);
    const text = p?.part?.text || p?.delta || "";
    if (typeof text !== "string" || !text) continue;
    if (/构建|设计分析|需求|代理|completed|agent cards|sub-agent|sub session/i.test(text) && text.length < 300) {
      console.log(`--- found in session ${p?.part?.sessionID || "-"} ---`);
      console.log(text.slice(0, 500));
      console.log("...");
      matchCount++;
      if (matchCount > 5) break;
    }
  } catch {}
}
console.log(`\nTotal matches: ${matchCount}`);

db.close();
