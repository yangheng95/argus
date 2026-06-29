#!/usr/bin/env bun
/**
 * SSE Doctor — 用 benchmark 环境启动服务，创建 task，截获 SSE，诊断消息流
 *
 * 用法：bun run packages/overlay/test/sse-doctor.ts
 */
import path from "path"
import os from "node:os"
import fs from "node:fs/promises"

const benchDir = path.resolve(import.meta.dir, "../../opencorvus/script/benchmark")
const { loadBenchmarkEnv, prepareDashscopeEnv, resolveBenchmarkModel, ensureBenchmarkModel } = await import(
  path.join(benchDir, "env.ts")
)

// ── 环境初始化（跟 overlay-web-benchmark 一致）──
await loadBenchmarkEnv(benchDir)
prepareDashscopeEnv()
const model = await resolveBenchmarkModel(benchDir, { allowOpenAICodex: false })
process.env.OPENCORVUS_BENCHMARK_MODEL = model
console.log(`[doctor] model: ${model}`)

const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "sse-doctor-home-"))
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sse-doctor-project-"))
process.env.OPENCORVUS_HOME = tempHome

// Copy auth.json
const appData = process.env.APPDATA || process.env.LOCALAPPDATA
const realDataDir =
  process.platform === "win32" && appData
    ? path.join(appData, "opencorvus")
    : path.join(os.homedir(), ".local", "share", "opencorvus")
const tempDataDir = path.join(tempHome, "data")
await fs.mkdir(tempDataDir, { recursive: true })
await fs.copyFile(path.join(realDataDir, "auth.json"), path.join(tempDataDir, "auth.json")).catch(() => undefined)

const tempConfig = path.join(tempHome, "config-override")
process.env.OPENCORVUS_CONFIG_DIR = tempConfig
await ensureBenchmarkModel(benchDir, model)

process.env.OPENCORVUS_AUTO_DISCOVER_EXECUTORS = "1"

// Log must init before any module that calls Log.create at top level
const logMod = await import("../../opencorvus/src/util/log")
logMod.Log.init({ print: true })
const { Instance } = await import("../../opencorvus/src/project/instance")
const { InstanceBootstrap } = await import("../../opencorvus/src/project/bootstrap")
const { Server } = await import("../../opencorvus/src/server/server")
const { resetDatabase } = await import("../../opencorvus/test/fixture/db")

// Scaffold minimal project
await fs.mkdir(path.join(tempDir, "src"), { recursive: true })
await fs.writeFile(path.join(tempDir, "src", "hello.ts"), 'export const hello = "world";\n')

await resetDatabase()

await Instance.provide({
  directory: tempDir,
  init: InstanceBootstrap,
  fn: async () => {
    const port = 18900 + Math.floor(Math.random() * 100)
    const server = await Server.listen({ port, hostname: "127.0.0.1" })
    const SERVER = `http://127.0.0.1:${port}`
    console.log(`[doctor] server: ${SERVER}`)

    // ── 创建 task ──
    const createRes = await fetch(`${SERVER}/task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request:
          "Create a file src/count.ts that exports a function count(n: number): number that returns n+1. Then create src/count.test.ts using bun:test that tests count(1)===2.",
        executor: "opencorvus",
      }),
    })
    const createData = (await createRes.json()) as any
    const taskID = createData.task_id
    if (!taskID) {
      console.error("[doctor] Failed to create task:", JSON.stringify(createData).slice(0, 300))
      process.exit(1)
    }
    console.log(`[doctor] task: ${taskID}\n`)

    // ── SSE 截获 ──
    const store = new Map<string, { info: any; parts: Map<string, any> }>()
    let deltaCount = 0
    let deltaChars = 0
    let eventCount = 0
    let msgEventCount = 0
    const eventTypes: Record<string, number> = {}
    const controller = new AbortController()
    const deadline = setTimeout(() => controller.abort(), 120_000)
    let taskDone = false

    // 定时 transcript diff
    const snapTimer = setInterval(async () => {
      try {
        const tr = (await (await fetch(`${SERVER}/task/${taskID}/transcript`)).json()) as any[]
        const tParts = new Map<string, string>()
        for (const msg of Array.isArray(tr) ? tr : []) {
          for (const p of msg.parts || []) {
            if (typeof p.text === "string" && p.id) tParts.set(`${msg.info.id}:${p.id}`, p.text)
          }
        }
        // 对比
        let issues = 0
        let emptyInTranscript = 0
        for (const [key, tText] of tParts) {
          if (tText === "") emptyInTranscript++
        }
        console.log(
          `[diff] transcript=${tr.length}msgs/${tParts.size}parts sse=${store.size}msgs deltas=${deltaCount}(${deltaChars}c) empty_transcript_parts=${emptyInTranscript}`,
        )
        if (emptyInTranscript > 0) {
          console.log(`  ⚠️ ${emptyInTranscript} parts have text="" in transcript — syncTask would wipe streamed text`)
        }
      } catch (e: any) {
        console.log(`[diff] error: ${e.message}`)
      }
    }, 5000)

    try {
      const res = await fetch(`${SERVER}/task/${taskID}/events`, {
        headers: { Accept: "text/event-stream" },
        signal: controller.signal,
      })
      if (!res.ok || !res.body) {
        console.error(`[SSE] Failed: ${res.status}`)
        clearInterval(snapTimer)
        clearTimeout(deadline)
        return
      }
      console.log("[SSE] ✅ Connected\n")

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          console.log("\n[SSE] Stream ended")
          break
        }
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
                const agentLabel = typeof info.agent === "string" && info.agent ? info.agent : "<missing-agent>"
                console.log(
                  `[evt] message.updated id=${info.id.slice(-8)} role=${info.role} agent=${agentLabel}`,
                )
              }
            } else if (type === "message.part.updated") {
              msgEventCount++
              const part = p.part
              if (part?.id && part?.messageID) {
                let msg = store.get(part.messageID)
                if (!msg) {
                  msg = { info: { id: part.messageID }, parts: new Map() }
                  store.set(part.messageID, msg)
                }
                msg.parts.set(part.id, { ...part })
                console.log(
                  `[evt] part.updated msg=${part.messageID.slice(-8)} part=${part.id.slice(-8)} type=${part.type} text=${(part.text || "").length}c`,
                )
              }
            } else if (type === "message.part.delta") {
              msgEventCount++
              deltaCount++
              const delta = p.delta || ""
              deltaChars += delta.length
              if (p.messageID && p.partID) {
                let msg = store.get(p.messageID)
                if (!msg) {
                  msg = { info: { id: p.messageID }, parts: new Map() }
                  store.set(p.messageID, msg)
                }
                let part = msg.parts.get(p.partID)
                if (!part) {
                  part = { id: p.partID, type: "text", text: "" }
                  msg.parts.set(p.partID, part)
                }
                if (p.field === "text") part.text = (part.text || "") + delta
              }
              if (deltaCount % 20 === 0) console.log(`[delta] ${deltaCount} deltas ${deltaChars}c`)
            } else {
              // 非消息事件
              if (type.includes("task.")) {
                const status = p.status || event.summary || ""
                console.log(`[evt] ${type}: ${status}`)
                if (status === "completed" || status === "failed" || status === "cancelled") {
                  taskDone = true
                  console.log(`\n[doctor] Task ${status}. Error: ${p.error || "none"}`)
                  controller.abort()
                }
              } else if (type.includes("agent.")) {
                console.log(`[evt] ${type}: stage=${p.stage} kind=${p.kind} ${(event.summary || "").slice(0, 60)}`)
              }
            }
          } catch {}
        }
      }
    } catch (e: any) {
      if (e.name !== "AbortError") console.error(`[SSE] Error: ${e.message}`)
    }

    clearInterval(snapTimer)
    clearTimeout(deadline)

    // ── 报告 ──
    console.log("\n" + "=".repeat(60))
    console.log("SSE DOCTOR REPORT")
    console.log("=".repeat(60))
    console.log(`Events total: ${eventCount}`)
    console.log(`Message events: ${msgEventCount} (updated/part.updated/delta)`)
    console.log(`  message.part.delta: ${deltaCount} (${deltaChars} chars)`)
    console.log(`SSE store messages: ${store.size}`)
    console.log(`Event types:`)
    for (const [t, c] of Object.entries(eventTypes).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${t}: ${c}`)
    }

    if (msgEventCount === 0) {
      console.log(`\n❌ 零条消息事件 — task-message-protocol-bridge 可能未桥接`)
    } else if (deltaCount === 0) {
      console.log(`\n⚠️ 有消息事件但无 delta — 流式可能不工作`)
    } else {
      console.log(`\n✅ 消息事件和 delta 都到达`)
    }

    // 最终 transcript
    try {
      const tr = (await (await fetch(`${SERVER}/task/${taskID}/transcript`)).json()) as any[]
      let emptyParts = 0
      let totalParts = 0
      for (const msg of Array.isArray(tr) ? tr : []) {
        for (const p of msg.parts || []) {
          if (typeof p.text === "string") {
            totalParts++
            if (p.text === "") emptyParts++
          }
        }
      }
      console.log(`\nTranscript: ${tr.length} msgs, ${totalParts} text parts, ${emptyParts} empty`)
      if (emptyParts > 0) {
        console.log(`⚠️ ${emptyParts} parts with text="" — syncTask 调用时会清空流式文本`)
        console.log(`  → 这就是"消息刷不见"的根因：syncTask 用 transcript 覆盖了 delta 累积`)
      }
    } catch {}

    console.log("=".repeat(60))

    server.stop()
    await fs.rm(tempHome, { recursive: true, force: true }).catch(() => {})
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  },
})
