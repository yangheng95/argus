import type { MessageV2 } from "../../session/message"
import type { CallRecord } from "../../session/llm-trace"

type SessionLike = {
  id: string
  title: string
  time: {
    created: number
    updated: number
  }
}

export async function buildSessionTraceHtml(input: {
  session: SessionLike
  messages: MessageV2.WithParts[]
  calls: CallRecord[]
}) {
  const calls = [...input.calls].sort((a, b) => a.started_at - b.started_at)
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

  const callHtml = calls.length
    ? calls
        .map((call, index) => {
          const header = [
            `#${index + 1}`,
            `${call.model.provider_id}/${call.model.model_id}`,
            call.status.toUpperCase(),
            `${call.steps.length} step`,
            formatDate(call.started_at),
          ].join(" | ")
          const system = call.request.system
            .map(
              (item, idx) =>
                `<details class="card sub"><summary>system[${idx}] (${item.length} chars)</summary><pre>${escape(item)}</pre></details>`,
            )
            .join("")
          const steps = call.steps
            .map((step) =>
              [
                `<details class="card sub">`,
                `<summary>step ${step.index} | ${escape(step.finish_reason)} | model ${escape(step.response.model_id)}</summary>`,
                `<div class="meta">`,
                `<span><b>response_id:</b> ${escape(step.response.id)}</span>`,
                `<span><b>time:</b> ${escape(step.response.timestamp)}</span>`,
                `</div>`,
                `<details class="card tiny"><summary>request.body</summary><pre>${json(step.request_body)}</pre></details>`,
                `<details class="card tiny"><summary>tool_calls</summary><pre>${json(step.tool_calls)}</pre></details>`,
                `<details class="card tiny"><summary>tool_results</summary><pre>${json(step.tool_results)}</pre></details>`,
                `<details class="card tiny"><summary>usage</summary><pre>${json(step.usage)}</pre></details>`,
                `<details class="card tiny"><summary>warnings</summary><pre>${json(step.warnings)}</pre></details>`,
                `<details class="card tiny"><summary>text</summary><pre>${escape(step.text)}</pre></details>`,
                `</details>`,
              ].join(""),
            )
            .join("")

          return [
            `<details class="card call">`,
            `<summary>${escape(header)}</summary>`,
            `<div class="meta">`,
            `<span><b>session:</b> ${escape(call.session_id)}</span>`,
            `<span><b>user_message:</b> ${escape(call.user_message_id)}</span>`,
            `<span><b>agent:</b> ${escape(call.agent.name)} (${escape(call.agent.mode)})</span>`,
            `<span><b>small:</b> ${call.small ? "yes" : "no"}</span>`,
            `<span><b>finish_reason:</b> ${escape(call.finish_reason ?? "-")}</span>`,
            `</div>`,
            `<details class="card sub"><summary>request.system (${call.request.system.length})</summary>${system || `<p class="empty">none</p>`}</details>`,
            `<details class="card sub"><summary>request.messages</summary><pre>${json(call.request.messages)}</pre></details>`,
            `<details class="card sub"><summary>request.settings</summary><pre>${json({
              tools: call.request.tools,
              tool_choice: call.request.tool_choice,
              max_retries: call.request.max_retries,
              max_output_tokens: call.request.max_output_tokens,
              temperature: call.request.temperature,
              top_p: call.request.top_p,
              top_k: call.request.top_k,
              headers: call.request.headers,
              provider_options: call.request.provider_options,
            })}</pre></details>`,
            `<details class="card sub" open><summary>steps (${call.steps.length})</summary>${steps}</details>`,
            `<details class="card sub"><summary>result</summary><pre>${json({
              status: call.status,
              total_usage: call.total_usage,
              error: call.error,
            })}</pre></details>`,
            `</details>`,
          ].join("")
        })
        .join("")
    : `<div class="card empty">No LLM trace file found. Set <code>OPENCORVUS_LLM_TRACE=1</code> before running the session.</div>`

  return [
    "<!doctype html>",
    `<html lang="en">`,
    "<head>",
    `<meta charset="utf-8" />`,
    `<meta name="viewport" content="width=device-width, initial-scale=1" />`,
    `<title>${escape(input.session.title)} | LLM Trace</title>`,
    `<style>
      :root { --bg:#0e1116; --panel:#161b22; --panel2:#0f141b; --text:#e6edf3; --muted:#9fb0c3; --line:#30363d; --accent:#58a6ff; }
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
    `<h1>Session LLM Trace Report</h1>`,
    `<div class="summary">`,
    `<div><b>session_id</b><br/>${escape(input.session.id)}</div>`,
    `<div><b>title</b><br/>${escape(input.session.title)}</div>`,
    `<div><b>created</b><br/>${escape(formatDate(input.session.time.created))}</div>`,
    `<div><b>updated</b><br/>${escape(formatDate(input.session.time.updated))}</div>`,
    `<div><b>messages</b><br/>${input.messages.length}</div>`,
    `<div><b>llm calls</b><br/>${calls.length}</div>`,
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

async function renderPart(part: MessageV2.Part) {
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
