import { Database } from "bun:sqlite";

const db = new Database("C:/Users/hengu/.local/share/opencorvus/opencorvus.db", { readonly: true });
const TASK = "tsk_dc59a62d7001wJppaWrxgEkSj6";

const tables = db.query(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all();
console.log("TABLES:");
for (const t of tables as any[]) console.log("  -", t.name);
