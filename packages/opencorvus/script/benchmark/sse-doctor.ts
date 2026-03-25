#!/usr/bin/env bun
/**
 * SSE Doctor — 诊断消息事件流是否工作
 * 用法：bun run packages/opencorvus/script/benchmark/sse-doctor.ts
 */
import path from "path"
import os from "node:os"
import fs from "node:fs/promises"

const { ensureBenchmarkModel, loadBenchmarkEnv, prepareDashscopeEnv, resolveBenchmarkModel } = await import("./env")
const { Log } = await import("../../src/util/log")
Log.init({ print: true })
const { Instance } = await import("../../src/project/instance")
const { InstanceBootstrap } = await import("../../src/project/bootstrap")
const { Server } = await import("../../src/server/server")
const { resetDatabase } = await import("../../test/fixture/db")
const { ExecutorBootstrap } = await import("../../src/executor/bootstrap")

await loadBenchmarkEnv(import.meta.dir)
prepareDashscopeEnv()
const model = process.env.OPENCORVUS_BENCHMARK_MODEL || await resolveBenchmarkModel(import.meta.dir, { allowOpenAICodex: false }).catch(() => "github-copilot/gemini-3-flash-preview")
process.env.OPENCORVUS_BENCHMARK_MODEL = model
console.log(`[doctor] model: ${model}`)

const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "sse-doctor-home-"))
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sse-doctor-project-"))
process.env.OPENCORVUS_HOME = tempHome

const appData = process.env.APPDATA || process.env.LOCALAPPDATA
const realDataDir = process.platform === "win32" && appData
  ? path.join(appData, "opencorvus")
  : path.join(os.homedir(), ".local", "share", "opencorvus")
await fs.mkdir(path.join(tempHome, "data"), { recursive: true })
await fs.copyFile(path.join(realDataDir, "auth.json"), path.join(tempHome, "data", "auth.json")).catch(() => undefined)

const tempConfig = path.join(tempHome, "config-override")
process.env.OPENCORVUS_CONFIG_DIR = tempConfig
await ensureBenchmarkModel(import.meta.dir, model)
process.env.OPENCORVUS_AUTO_DISCOVER_EXECUTORS = "1"

await fs.mkdir(path.join(tempDir, "src"), { recursive: true })
await fs.writeFile(path.join(tempDir, "src", "hello.ts"), 'export const hello = "world";\n')

await resetDatabase()

await Instance.provide({
  directory: tempDir,
  init: InstanceBootstrap,
  fn: async () => {
await ExecutorBootstrap.autoRegister(true)
  },
})

const port = 18900 + Math.floor(Math.random() * 100)
const server = await Server.listen({ port, hostname: "127.0.0.1" })
const SERVER = `http://127.0.0.1:${port}`

console.log(`[doctor] server: ${SERVER}`)

// 创建 task
const createRes = await fetch(`${SERVER}/task`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    request: 'Create src/count.ts exporting function count(n: number): number { return n + 1 }. Then create src/count.test.ts using bun:test with one test: expect(count(1)).toBe(2).',
    executor: "opencode",
  }),
})
const createData = await createRes.json() as any
const taskID = createData.task_id
if (!taskID) { console.error("No taskID:", createData); process.exit(1) }
console.log(`[doctor] task: ${taskID}\n`)

// SSE
const store = new Map<string, { info: any; parts: Map<string, any> }>()
let deltaCount = 0, deltaChars = 0, eventCount = 0, msgEventCount = 0
const eventTypes: Record<string, number> = {}
const controller = new AbortController()
const deadline = setTimeout(() => controller.abort(), 120_000)

const snapTimer = setInterval(async () => {
  try {
    const tr = await (await fetch(`${SERVER}/task/${taskID}/transcript`)).json() as any[]
    let emptyParts = 0, totalParts = 0
    for (const msg of (Array.isArray(tr) ? tr : [])) {
      for (const p of (msg.parts || [])) {
        if (typeof p.text === "string") { totalParts++; if (p.text === "") emptyParts++ }
      }
    }
    console.log(`[diff] transcript=${tr.length}msgs/${totalParts}parts sse=${store.size}msgs deltas=${deltaCount}(${deltaChars}c) empty=${emptyParts}`)
  } catch {}
}, 5000)

try {
  const res = await fetch(`${SERVER}/task/${taskID}/events`, { signal: controller.signal })
  if (!res.ok || !res.body) { console.error(`SSE ${res.status}`); process.exit(1) }
  console.log("[SSE] ✅ Connected\n")

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) { console.log("\n[SSE] Stream ended"); break }
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() || ""

    for (const line of lines) {
      if (!line.startsWith("data:")) continue
      try {
        const event = JSON.parse(line.slice(5).trim())
        const type = event.type || ""
        if (type === "task.heartbeat" || type === "task.connected") continue
        eventCount++
        eventTypes[type] = (eventTypes[type] || 0) + 1
        const p = event.payload || event.properties || {}

        if (type === "message.updated") {
          msgEventCount++
          const info = p.info
          if (info?.id) {
            if (!store.has(info.id)) store.set(info.id, { info, parts: new Map() })
            else store.get(info.id)!.info = info
            console.log(`[msg.updated] ${info.id.slice(-8)} role=${info.role} agent=${info.agent || "-"}`)
          }
        } else if (type === "message.part.updated") {
          msgEventCount++
          const part = p.part
          if (part?.id && part?.messageID) {
            let msg = store.get(part.messageID)
            if (!msg) { msg = { info: { id: part.messageID }, parts: new Map() }; store.set(part.messageID, msg) }
            msg.parts.set(part.id, { ...part })
            console.log(`[part.updated] ${part.id.slice(-8)} type=${part.type} text=${(part.text || "").length}c`)
          }
        } else if (type === "message.part.delta") {
          msgEventCount++; deltaCount++
          const delta = p.delta || ""; deltaChars += delta.length
          if (p.messageID && p.partID) {
            let msg = store.get(p.messageID)
            if (!msg) { msg = { info: { id: p.messageID }, parts: new Map() }; store.set(p.messageID, msg) }
            let part = msg.parts.get(p.partID)
            if (!part) { part = { id: p.partID, type: "text", text: "" }; msg.parts.set(p.partID, part) }
            if (p.field === "text") part.text = (part.text || "") + delta
          }
          if (deltaCount % 20 === 0) console.log(`[delta] ${deltaCount} (${deltaChars}c)`)
        } else if (type.includes("task.")) {
          const status = p.status || event.summary || ""
          console.log(`[${type}] ${status}`)
          if (["completed", "failed", "cancelled"].includes(status)) {
            console.log(`\n[doctor] Task ${status}. Error: ${p.error || "none"}`)
            controller.abort()
          }
        } else if (type.includes("agent.")) {
          console.log(`[${type}] stage=${p.stage} kind=${p.kind} ${(event.summary || "").slice(0, 60)}`)
        }
      } catch {}
    }
  }
} catch (e: any) {
  if (e.name !== "AbortError") console.error(`[SSE] ${e.message}`)
}

clearInterval(snapTimer); clearTimeout(deadline)

// Report
console.log("\n" + "=".repeat(60))
console.log("SSE DOCTOR REPORT")
console.log("=".repeat(60))
console.log(`Events: ${eventCount}, Message events: ${msgEventCount}, Deltas: ${deltaCount} (${deltaChars}c)`)
console.log(`SSE store: ${store.size} messages`)
for (const [t, c] of Object.entries(eventTypes).sort((a, b) => b[1] - a[1])) console.log(`  ${t}: ${c}`)

if (msgEventCount === 0) console.log(`\n❌ 零消息事件 — bridge 未桥接`)
else if (deltaCount === 0) console.log(`\n⚠️ 有消息但无 delta — 流式不工作`)
else console.log(`\n✅ 消息和 delta 都正常`)

try {
  const tr = await (await fetch(`${SERVER}/task/${taskID}/transcript`)).json() as any[]
  let empty = 0, total = 0
  for (const msg of (Array.isArray(tr) ? tr : [])) {
    for (const p of (msg.parts || [])) {
      if (typeof p.text === "string") { total++; if (p.text === "") empty++ }
    }
  }
  console.log(`Transcript: ${tr.length} msgs, ${total} text parts, ${empty} empty`)
  if (empty > 0) console.log(`⚠️ ${empty} parts text="" — syncTask 会清空流式文本 → 消息消失`)
} catch {}
console.log("=".repeat(60))

server.stop()
await fs.rm(tempHome, { recursive: true, force: true }).catch(() => {})
await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
