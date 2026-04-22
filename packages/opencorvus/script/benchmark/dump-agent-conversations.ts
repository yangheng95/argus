#!/usr/bin/env bun
/**
 * Dump every message every agent saw and every message every agent sent,
 * from the benchmark's `opencorvus.db`, to a directory of Markdown files —
 * one file per session, grouped by agent kind.
 *
 * Goal: answer "is the communication between agents correct / optimal"
 * without having to tail an 11 MB log. Writes both a human-readable
 * transcript and a raw JSONL dump per session for post-hoc programmatic
 * filtering.
 *
 * Usage:
 *   bun script/benchmark/dump-agent-conversations.ts \
 *     --db "<absolute path to opencorvus.db>" \
 *     [--task tsk_xxx]  (default: latest task in the DB) \
 *     [--out <dir>]      (default: ./tmp-bench-reports/agent-transcripts-<taskID>)
 *
 * Each session writes two files under `<out>/<agent-kind>/`:
 *   <slug>__<short-sid>.md    — rendered transcript (boundaries, text,
 *                               reasoning, tool calls with I/O, timestamps)
 *   <slug>__<short-sid>.jsonl — one message-part per line, raw JSON shape
 *
 * The top-level `<out>/INDEX.md` lists every session with parent/goal
 * linkage so the reader can walk the orchestrator → sub-agent tree.
 *
 * Performance: single DB open, indexed queries; handles ~10k parts fine.
 * No SDK / engine imports — the script is a pure DB reader so it works on
 * snapshot databases from finished benchmarks without booting the server.
 */
import { Database } from "bun:sqlite"
import fs from "node:fs"
import path from "node:path"

// ── CLI args ──────────────────────────────────────────────────────────────

function flag(name: string): string | undefined {
  const eq = process.argv.find((item) => item.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const idx = process.argv.indexOf(name)
  if (idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith("--")) {
    return process.argv[idx + 1]
  }
  return undefined
}

const dbPathArg = flag("--db")
if (!dbPathArg) {
  console.error("[dump-agent-conversations] --db <path to opencorvus.db> is required")
  process.exit(2)
}
const dbPath = path.resolve(dbPathArg)
if (!fs.existsSync(dbPath)) {
  console.error(`[dump-agent-conversations] DB file not found: ${dbPath}`)
  process.exit(2)
}

// ── DB open + task selection ──────────────────────────────────────────────

const db = new Database(dbPath, { readonly: true })

function latestTaskID(): string {
  const row = db
    .query<{ id: string }, []>("SELECT id FROM engine_task ORDER BY time_created DESC LIMIT 1")
    .get()
  if (!row) {
    console.error("[dump-agent-conversations] no engine_task rows in DB")
    process.exit(2)
  }
  return row.id
}

const taskID = flag("--task") ?? latestTaskID()
const taskRow = db
  .query<{ id: string; title: string; request: string; status: string; session_id: string }, [string]>(
    "SELECT id, title, request, status, session_id FROM engine_task WHERE id = ?",
  )
  .get(taskID)
if (!taskRow) {
  console.error(`[dump-agent-conversations] task ${taskID} not found`)
  process.exit(2)
}

const outDir = path.resolve(
  flag("--out") ?? path.join(process.cwd(), "tmp-bench-reports", `agent-transcripts-${taskID}`),
)
fs.mkdirSync(outDir, { recursive: true })

// ── Session tree ──────────────────────────────────────────────────────────

interface SessionRow {
  id: string
  parent_id: string | null
  kind: string
  goal_id: string | null
  title: string | null
  slug: string | null
  time_created: number
  time_updated: number
}

/**
 * Collect every session reachable from the task's root session by walking
 * parent_id links forward — task.session_id is the root, every sub-agent
 * hangs under it directly or transitively.
 */
function collectSessions(rootSessionID: string): SessionRow[] {
  const all = db
    .query<SessionRow, []>(
      "SELECT id, parent_id, kind, goal_id, title, slug, time_created, time_updated FROM session",
    )
    .all()
  const byParent = new Map<string | null, SessionRow[]>()
  for (const s of all) {
    const p = s.parent_id ?? null
    const bucket = byParent.get(p) ?? []
    bucket.push(s)
    byParent.set(p, bucket)
  }
  const out: SessionRow[] = []
  const seen = new Set<string>()
  const queue: string[] = [rootSessionID]
  while (queue.length) {
    const current = queue.shift()!
    if (seen.has(current)) continue
    seen.add(current)
    const self = all.find((r) => r.id === current)
    if (self) out.push(self)
    const children = byParent.get(current) ?? []
    for (const c of children) queue.push(c.id)
  }
  return out.sort((a, b) => a.time_created - b.time_created)
}

const sessions = collectSessions(taskRow.session_id)
console.log(
  `[dump-agent-conversations] task=${taskRow.id} title="${taskRow.title}" sessions=${sessions.length}`,
)

// ── Rendering ─────────────────────────────────────────────────────────────

interface MessageRow {
  id: string
  time_created: number
  data: string // JSON: { role, agent, time, ... } — v2 Message.Info shape
}
interface PartRow {
  id: string
  time_created: number
  data: string // JSON: Message.Part shape (text, reasoning, tool, file, patch, …)
}

function fetchMessages(sessionID: string): MessageRow[] {
  return db
    .query<MessageRow, [string]>(
      "SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created, id",
    )
    .all(sessionID)
}
function fetchParts(messageID: string): PartRow[] {
  return db
    .query<PartRow, [string]>(
      "SELECT id, time_created, data FROM part WHERE message_id = ? ORDER BY id",
    )
    .all(messageID)
}

function ts(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").replace("Z", "")
}
function safeName(s: string | null | undefined, fallback: string): string {
  return (s ?? fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || fallback
}
function shortID(id: string): string {
  return id.slice(-10)
}

function renderPart(part: PartRow, depth = 0): string {
  const pad = " ".repeat(depth * 2)
  let d: any
  try {
    d = JSON.parse(part.data)
  } catch {
    return `${pad}- [corrupt part id=${part.id}]`
  }
  const type = d?.type ?? "unknown"
  switch (type) {
    case "text": {
      const text = String(d.text ?? "").trim()
      if (!text) return ""
      return `${pad}**text:**\n\n${fence(text)}`
    }
    case "reasoning": {
      const text = String(d.text ?? "").trim()
      if (!text) return ""
      return `${pad}**reasoning:**\n\n${fence(text)}`
    }
    case "tool": {
      const tool = d.tool ?? d.callID ?? "tool"
      const state = d.state ?? {}
      const status = state.status ?? "?"
      const cmd = state.input?.command ?? state.input?.cmd ?? ""
      const inputBlock = JSON.stringify(state.input ?? {}, null, 2)
      const outputRaw = state.output ?? state.result ?? ""
      const output = typeof outputRaw === "string" ? outputRaw : JSON.stringify(outputRaw, null, 2)
      const lines = [`${pad}**tool call:** \`${tool}\` (status: ${status})`]
      if (cmd) lines.push(`${pad}*command:* \`${cmd.slice(0, 300)}\``)
      lines.push(`${pad}*input:*\n\n${fence(inputBlock, "json")}`)
      if (output) lines.push(`${pad}*output:*\n\n${fence(String(output).slice(0, 4000))}`)
      return lines.join("\n")
    }
    case "file": {
      return `${pad}**file:** ${d.filename ?? d.name ?? "?"} (${d.mime ?? "?"}, ${d.size ?? "?"} bytes)`
    }
    case "patch": {
      const files = Array.isArray(d.files) ? d.files : []
      return `${pad}**patch:** ${files.length} file(s): ${files.slice(0, 10).join(", ")}${files.length > 10 ? ", …" : ""}`
    }
    default:
      return `${pad}**${type}:** \`${JSON.stringify(d).slice(0, 400)}\``
  }
}

function fence(body: string, lang = ""): string {
  const safe = body.replace(/```/g, "``​`")
  return ["```" + lang, safe, "```"].join("\n")
}

function renderSession(session: SessionRow): { md: string; jsonl: string; counts: { messages: number; parts: number } } {
  const mdLines: string[] = []
  const jsonlLines: string[] = []
  const messages = fetchMessages(session.id)

  let partCount = 0
  mdLines.push(`# ${session.kind.toUpperCase()} session — ${session.title ?? "(no title)"}`)
  mdLines.push("")
  mdLines.push(`- **session_id**: \`${session.id}\``)
  mdLines.push(`- **parent_id**: \`${session.parent_id ?? "(root)"}\``)
  mdLines.push(`- **goal_id**: \`${session.goal_id ?? "(none)"}\``)
  mdLines.push(`- **slug**: ${session.slug ?? "(none)"}`)
  mdLines.push(`- **time_created**: ${ts(session.time_created)}`)
  mdLines.push(`- **time_updated**: ${ts(session.time_updated)}`)
  mdLines.push(`- **message count**: ${messages.length}`)
  mdLines.push("")
  mdLines.push("---")
  mdLines.push("")

  for (const [idx, msg] of messages.entries()) {
    let msgData: any
    try {
      msgData = JSON.parse(msg.data)
    } catch {
      msgData = {}
    }
    const role = msgData.role ?? "unknown"
    const resolvedRole = msgData.resolvedRole ?? msgData.channel ?? role
    const agent = msgData.agent ?? ""

    mdLines.push(`## message #${idx + 1} — role=${role}${resolvedRole !== role ? ` resolvedRole=${resolvedRole}` : ""}${agent ? ` agent=${agent}` : ""} @ ${ts(msg.time_created)}`)
    mdLines.push("")
    mdLines.push(`*msg_id*: \`${msg.id}\``)
    mdLines.push("")

    const parts = fetchParts(msg.id)
    partCount += parts.length
    for (const part of parts) {
      const rendered = renderPart(part)
      if (rendered) {
        mdLines.push(rendered)
        mdLines.push("")
      }
      let partData: any
      try {
        partData = JSON.parse(part.data)
      } catch {
        partData = null
      }
      jsonlLines.push(
        JSON.stringify({
          session_id: session.id,
          session_kind: session.kind,
          msg_id: msg.id,
          msg_role: role,
          msg_resolvedRole: resolvedRole,
          msg_agent: agent,
          msg_time: msg.time_created,
          part_id: part.id,
          part_time: part.time_created,
          part: partData,
        }),
      )
    }

    mdLines.push("---")
    mdLines.push("")
  }

  return {
    md: mdLines.join("\n"),
    jsonl: jsonlLines.join("\n") + (jsonlLines.length ? "\n" : ""),
    counts: { messages: messages.length, parts: partCount },
  }
}

// ── Write out ─────────────────────────────────────────────────────────────

const perKind = new Map<string, SessionRow[]>()
for (const s of sessions) {
  const bucket = perKind.get(s.kind) ?? []
  bucket.push(s)
  perKind.set(s.kind, bucket)
}

const indexLines: string[] = []
indexLines.push(`# Agent transcripts — task ${taskRow.id}`)
indexLines.push("")
indexLines.push(`- **title**: ${taskRow.title}`)
indexLines.push(`- **status**: ${taskRow.status}`)
indexLines.push(`- **root session**: \`${taskRow.session_id}\``)
indexLines.push(`- **db**: \`${dbPath}\``)
indexLines.push("")
indexLines.push("## Original request")
indexLines.push("")
indexLines.push("```")
indexLines.push(taskRow.request.slice(0, 4000))
indexLines.push("```")
indexLines.push("")
indexLines.push("## Sessions grouped by kind")
indexLines.push("")

let totalMessages = 0
let totalParts = 0
for (const [kind, group] of [...perKind.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const kindDir = path.join(outDir, kind)
  fs.mkdirSync(kindDir, { recursive: true })
  indexLines.push(`### ${kind} (${group.length} sessions)`)
  indexLines.push("")
  for (const session of group.sort((a, b) => a.time_created - b.time_created)) {
    const { md, jsonl, counts } = renderSession(session)
    const slug = safeName(session.slug ?? session.title, session.id)
    const fileBase = `${slug}__${shortID(session.id)}`
    fs.writeFileSync(path.join(kindDir, `${fileBase}.md`), md)
    fs.writeFileSync(path.join(kindDir, `${fileBase}.jsonl`), jsonl)
    totalMessages += counts.messages
    totalParts += counts.parts
    const rel = path.join(kind, `${fileBase}.md`).replace(/\\/g, "/")
    indexLines.push(
      `- [\`${shortID(session.id)}\`](${rel}) — ${session.title ?? "(untitled)"} — ${counts.messages} msgs / ${counts.parts} parts`,
    )
  }
  indexLines.push("")
}

indexLines.push("---")
indexLines.push("")
indexLines.push(`**Totals**: ${sessions.length} sessions, ${totalMessages} messages, ${totalParts} parts.`)

fs.writeFileSync(path.join(outDir, "INDEX.md"), indexLines.join("\n"))

console.log(
  `[dump-agent-conversations] wrote ${sessions.length} sessions → ${outDir} (${totalMessages} messages, ${totalParts} parts)`,
)

db.close()
