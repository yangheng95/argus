import type { Message } from "../../session/message"
import type { TraceEvent } from "../../trace"

type SessionLike = {
  id: string
  title: string
  time: {
    created: number
    updated: number
  }
}

/**
 * Render an offline HTML report combining the conversation transcript and the
 * raw Trace events captured during the session. Replaces the older
 * CallRecord-based renderer; events are grouped by call_id (which the runtime
 * stamps onto every llm.step / tool.call / tool.result emitted from one LLM
 * invocation) so each "call" block reconstructs from streaming events.
 */
export async function buildSessionTraceHtml(input: {
  session: SessionLike
  messages: Message.WithParts[]
  events: TraceEvent[]
}) {
  const messageHtml = (
    await Promise.all(
      input.messages.map(async (message, index) => {
        const parts = await Promise.all(message.parts.map((part) => renderPart(part)))
        const created =
          message.info.role === "user"
            ? message.info.time.created
            : (message.info.time.completed ?? message.info.time.created)
        const header = [`#${index + 1}`, message.info.role.toUpperCase(), formatDate(created), message.info.id].join(
          " | ",
        )
        const info =
          message.info.role === "user"
            ? [
                ["agent", message.info.agent],
                ["model", `${message.info.model.providerID}/${message.info.model.modelID}`],
                ["variant", message.info.variant ?? "-"],
                ["system", message.info.system ? "custom" : "-"],
              ]
            : [
                ["agent", message.info.agent],
                ["model", `${message.info.providerID}/${message.info.modelID}`],
                ["finish", message.info.finish ?? "-"],
                ["cost", message.info.cost.toFixed(6)],
              ]
        return [
          `<details class="card message" open>`,
          `<summary>${escape(header)}</summary>`,
          `<div class="meta">${info.map(([k, v]) => `<span><b>${escape(k)}:</b> ${escape(v)}</span>`).join("")}</div>`,
          `<div class="parts">${parts.join("")}</div>`,
          `</details>`,
        ].join("")
      }),
    )
  ).join("")

  const calls = groupEventsByCall(input.events)
  const callHtml = calls.length
    ? calls.map((call, index) => renderCall(call, index)).join("")
    : `<div class="card empty">No LLM trace events for this session.</div>`

  return [
    "<!doctype html>",
    `<html lang="en">`,
    "<head>",
    `<meta charset="utf-8" />`,
    `<meta name="viewport" content="width=device-width, initial-scale=1" />`,
    `<title>${escape(input.session.title)} | Trace</title>`,
    `<style>
      :root { --bg:#0e1116; --panel:#161b22; --panel2:#0f141b; --text:#e6edf3; --muted:#9fb0c3; --line:#30363d; --accent:#58a6ff; --ok:#3fb950; --err:#f85149; }
      * { box-sizing: border-box; }
      body { margin:0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; background:var(--bg); color:var(--text); }
      main { max-width: 1300px; margin: 0 auto; padding: 16px; }
      h1,h2 { margin: 8px 0 12px; }
      h1 { font-size: 18px; color: var(--accent); }
      h2 { font-size: 15px; margin-top: 20px; }
      .toolbar { display:flex; gap:8px; margin: 10px 0 14px; }
      button { border:1px solid var(--line); background:var(--panel); color:var(--text); padding:6px 10px; border-radius:8px; cursor:pointer; }
      .summary { display:grid; gap:6px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); margin-bottom: 12px; }
      .summary div { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:8px 10px; }
      .card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:8px 10px; margin:8px 0; }
      .sub { background:var(--panel2); }
      .tiny { background:var(--bg); }
      .empty { color: var(--muted); }
      summary { cursor:pointer; color:#c9d1d9; }
      pre { white-space: pre-wrap; word-break: break-word; background:#0b0f14; border:1px solid var(--line); border-radius:8px; padding:8px; margin:8px 0 0; font-size:12px; line-height:1.45; }
      .meta { display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; }
      .meta span { background:#101620; border:1px solid var(--line); border-radius:999px; padding:3px 8px; color:var(--muted); font-size:12px; }
      .status-finished, .status-ok { color: var(--ok); }
      .status-error, .status-aborted { color: var(--err); }
      .parts { margin-top: 8px; }
      .part { border:1px solid var(--line); border-radius:8px; background:#0c1118; margin:8px 0; padding:8px; }
      .part h4 { margin:0; font-size:12px; color:var(--accent); }
      .attachment-list { display:flex; flex-wrap: wrap; gap:10px; margin-top:8px; }
      .attachment { border:1px solid var(--line); border-radius:8px; padding:6px; background:#0b0f14; max-width: 380px; }
      .attachment img { max-width:100%; border-radius:6px; display:block; }
      .attachment .cap { color:var(--muted); font-size:11px; margin-top:4px; }
      a { color: var(--accent); }
      code { color:#d2a8ff; }
    </style>`,
    "</head>",
    "<body>",
    "<main>",
    `<h1>Session Trace Report</h1>`,
    `<div class="summary">`,
    `<div><b>session_id</b><br/>${escape(input.session.id)}</div>`,
    `<div><b>title</b><br/>${escape(input.session.title)}</div>`,
    `<div><b>created</b><br/>${escape(formatDate(input.session.time.created))}</div>`,
    `<div><b>updated</b><br/>${escape(formatDate(input.session.time.updated))}</div>`,
    `<div><b>messages</b><br/>${input.messages.length}</div>`,
    `<div><b>llm calls</b><br/>${calls.length}</div>`,
    `<div><b>trace events</b><br/>${input.events.length}</div>`,
    `</div>`,
    `<div class="toolbar">`,
    `<button onclick="toggleAll(true)">Expand All</button>`,
    `<button onclick="toggleAll(false)">Collapse All</button>`,
    `</div>`,
    `<h2>LLM Calls</h2>`,
    callHtml,
    `<h2>Conversation + Tool Parts (with screenshots)</h2>`,
    messageHtml,
    "</main>",
    `<script>
      function toggleAll(open) {
        document.querySelectorAll("details").forEach((el) => { el.open = open })
      }
    </script>`,
    "</body>",
    "</html>",
  ].join("\n")
}

// ── Event grouping ──────────────────────────────────────────────────────────
// Trace emits agent.start → llm.step × N (with tool.call/result interleaved)
// → llm.finish/error → agent.finish, all sharing the same call_id in payload.
// Group them so the report renders each LLM invocation as one block.

interface CallGroup {
  call_id: string
  agent: string | undefined
  start: TraceEvent | undefined
  finish: TraceEvent | undefined
  steps: TraceEvent[]
  toolCalls: TraceEvent[]
  toolResults: TraceEvent[]
  startedAt: number
}

function callIDOf(ev: TraceEvent): string | undefined {
  const p = ev.payload as { call_id?: string } | undefined
  return p?.call_id
}

function groupEventsByCall(events: TraceEvent[]): CallGroup[] {
  const groups = new Map<string, CallGroup>()
  for (const ev of events) {
    const id = callIDOf(ev)
    if (!id) continue
    let g = groups.get(id)
    if (!g) {
      g = { call_id: id, agent: ev.agent, start: undefined, finish: undefined, steps: [], toolCalls: [], toolResults: [], startedAt: ev.ts }
      groups.set(id, g)
    }
    if (ev.category === "agent.start") g.start = ev
    else if (ev.category === "llm.finish" || ev.category === "llm.error") g.finish = ev
    else if (ev.category === "llm.step") g.steps.push(ev)
    else if (ev.category === "tool.call") g.toolCalls.push(ev)
    else if (ev.category === "tool.result" || ev.category === "tool.error") g.toolResults.push(ev)
  }
  return [...groups.values()].sort((a, b) => a.startedAt - b.startedAt)
}

function renderCall(call: CallGroup, index: number): string {
  const startPayload = (call.start?.payload ?? {}) as Record<string, unknown>
  const finishPayload = (call.finish?.payload ?? {}) as Record<string, unknown>
  const status = (finishPayload.status as string) ?? (call.finish ? "finished" : "running")
  const model = (startPayload.model ?? {}) as { providerID?: string; modelID?: string }
  const modelLabel = model.providerID ? `${model.providerID}/${model.modelID}` : "?"
  const header = [
    `#${index + 1}`,
    modelLabel,
    status.toUpperCase(),
    `${call.steps.length} step`,
    formatDate(call.startedAt),
  ].join(" | ")

  const stepsHtml = call.steps
    .map((step) => {
      const p = (step.payload ?? {}) as Record<string, unknown>
      const round = step.round ?? "-"
      const finishReason = (p.finish_reason as string) ?? "-"
      return [
        `<details class="card sub">`,
        `<summary>step ${round} | ${escape(finishReason)}</summary>`,
        `<pre>${json(p)}</pre>`,
        `</details>`,
      ].join("")
    })
    .join("")

  const toolsHtml = renderTools(call.toolCalls, call.toolResults)

  return [
    `<details class="card call">`,
    `<summary>${escape(header)}</summary>`,
    `<div class="meta">`,
    call.agent ? `<span><b>agent:</b> ${escape(call.agent)}</span>` : "",
    `<span><b>call_id:</b> ${escape(call.call_id)}</span>`,
    `<span class="status-${escape(status)}"><b>status:</b> ${escape(status)}</span>`,
    typeof startPayload.tool_count === "number" ? `<span><b>tools:</b> ${startPayload.tool_count}</span>` : "",
    typeof startPayload.message_count === "number" ? `<span><b>messages:</b> ${startPayload.message_count}</span>` : "",
    typeof finishPayload.duration_ms === "number" ? `<span><b>duration:</b> ${finishPayload.duration_ms}ms</span>` : "",
    `</div>`,
    `<details class="card sub" open><summary>steps (${call.steps.length})</summary>${stepsHtml || `<p class="empty">none</p>`}</details>`,
    toolsHtml,
    `<details class="card sub"><summary>start payload</summary><pre>${json(startPayload)}</pre></details>`,
    `<details class="card sub"><summary>finish payload</summary><pre>${json(finishPayload)}</pre></details>`,
    `</details>`,
  ].filter(Boolean).join("")
}

function renderTools(calls: TraceEvent[], results: TraceEvent[]): string {
  if (calls.length === 0 && results.length === 0) return ""
  const items = [...calls, ...results].sort((a, b) => a.seq - b.seq).map((ev) => {
    const p = (ev.payload ?? {}) as Record<string, unknown>
    const tool = (p.tool as string) ?? "?"
    const id = (p.call_id as string) ?? ""
    return [
      `<details class="card tiny">`,
      `<summary>${escape(ev.category)} | ${escape(tool)} | ${escape(id)}</summary>`,
      `<pre>${json(p)}</pre>`,
      `</details>`,
    ].join("")
  }).join("")
  return `<details class="card sub"><summary>tools (${calls.length} calls, ${results.length} results)</summary>${items}</details>`
}

async function renderPart(part: Message.Part) {
  switch (part.type) {
    case "text":
      return `<section class="part"><h4>text</h4><pre>${escape(part.text)}</pre></section>`
    case "reasoning":
      return `<section class="part"><h4>reasoning</h4><pre>${escape(part.text)}</pre></section>`
    case "file": {
      const preview = await renderAttachment({ mime: part.mime, url: part.url, filename: part.filename })
      return `<section class="part"><h4>file</h4>${preview}</section>`
    }
    case "tool": {
      const base = [
        `<section class="part">`,
        `<h4>tool.${escape(part.tool)} | ${escape(part.state.status)}</h4>`,
        `<pre>${json({ call_id: part.callID, metadata: part.metadata ?? null })}</pre>`,
      ]
      if (part.state.status === "pending") {
        base.push(`<pre>${json(part.state.input)}</pre>`)
      }
      if (part.state.status === "running") {
        base.push(`<pre>${json(part.state.input)}</pre>`)
      }
      if (part.state.status === "error") {
        base.push(
          `<pre>${json({ input: part.state.input, error: part.state.error, metadata: part.state.metadata })}</pre>`,
        )
      }
      if (part.state.status === "completed") {
        base.push(
          `<pre>${json({ input: part.state.input, output: part.state.output, metadata: part.state.metadata })}</pre>`,
        )
        const files = await Promise.all((part.state.attachments ?? []).map((item) => renderAttachment(item)))
        if (files.length > 0) {
          base.push(`<div class="attachment-list">${files.join("")}</div>`)
        }
      }
      base.push(`</section>`)
      return base.join("")
    }
    case "step-start":
      return `<section class="part"><h4>step-start</h4><pre>${json({ snapshot: part.snapshot ?? null })}</pre></section>`
    case "step-finish":
      return `<section class="part"><h4>step-finish</h4><pre>${json({
        reason: part.reason,
        cost: part.cost,
        tokens: part.tokens,
        snapshot: part.snapshot ?? null,
      })}</pre></section>`
    case "snapshot":
      return `<section class="part"><h4>snapshot</h4><pre>${json({ snapshot: part.snapshot })}</pre></section>`
    case "patch":
      return `<section class="part"><h4>patch</h4><pre>${json({ hash: part.hash, files: part.files })}</pre></section>`
    case "retry":
      return `<section class="part"><h4>retry</h4><pre>${json({ attempt: part.attempt, error: part.error })}</pre></section>`
    case "agent":
      return `<section class="part"><h4>agent</h4><pre>${json({ name: part.name, source: part.source ?? null })}</pre></section>`
    case "subtask":
      return `<section class="part"><h4>subtask</h4><pre>${json({
        prompt: part.prompt,
        description: part.description,
        agent: part.agent,
        model: part.model ?? null,
        command: part.command ?? null,
      })}</pre></section>`
    case "compaction":
      return `<section class="part"><h4>compaction</h4><pre>${json({ auto: part.auto })}</pre></section>`
  }
}

async function renderAttachment(input: { mime: string; url: string; filename?: string }) {
  const url = await resolveAttachmentUrl(input.url)
  if (input.mime.startsWith("image/")) {
    return [
      `<div class="attachment">`,
      `<img src="${escape(url)}" alt="${escape(input.filename ?? "image")}" loading="lazy" />`,
      `<div class="cap">${escape(input.filename ?? "image")} | ${escape(input.mime)}</div>`,
      `</div>`,
    ].join("")
  }
  return [
    `<div class="attachment">`,
    `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(input.filename ?? "file")}</a>`,
    `<div class="cap">${escape(input.mime)}</div>`,
    `</div>`,
  ].join("")
}

async function resolveAttachmentUrl(url: string) {
  return url
}

function escape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function formatDate(value: number | string) {
  const date = typeof value === "number" ? new Date(value) : new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toISOString()
}

function json(value: unknown) {
  try {
    return escape(JSON.stringify(value, null, 2))
  } catch {
    return escape(String(value))
  }
}
