/**
 * Message system benchmark — 直接截获后端 SSE 事件流和 transcript 快照
 * 不依赖 overlay UI，纯后端验证
 *
 * 用法：
 *   bun run packages/overlay/test/message-bench.ts [taskID]
 *
 * 如果不传 taskID，自动使用最近的 running task
 *
 * 验收标准：
 *   1. SSE 连接成功，事件持续到达
 *   2. message.part.delta 事件存在（流式）
 *   3. delta 累计文本与 transcript 快照一致（不丢字）
 *   4. syncTask 不会丢失 delta 累积（transcript 覆盖问题检测）
 */

const SERVER = process.env.OPENCORVUS_SERVER || "http://127.0.0.1:7878"
const AUTH = process.env.OPENCORVUS_PASSWORD || ""

function headers(): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/json" }
  if (AUTH) h.Authorization = `Basic ${btoa(`opencorvus:${AUTH}`)}`
  return h
}

async function api(path: string) {
  const res = await fetch(`${SERVER}/${path}`, { headers: headers() })
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`)
  return res.json()
}

// ── 找 task ──
async function findTaskID(): Promise<string> {
  const arg = process.argv[2]
  if (arg) return arg
  const tasks: any[] = await api("tasks")
  const running = tasks.find((t: any) =>
    ["running", "planning", "evaluating", "delivering", "queued", "blocked"].includes(t?.task?.status),
  )
  if (running) return running.task.id
  if (tasks.length > 0) return tasks[0].task.id
  throw new Error("No tasks found")
}

// ── 统计 ──
const stats = {
  sseConnected: false,
  eventsTotal: 0,
  eventsByType: {} as Record<string, number>,
  messageUpdated: 0,
  partUpdated: 0,
  partDelta: 0,
  deltaChars: 0,
  // 按 messageID:partID 累计 delta 文本
  deltaAccum: new Map<string, string>(),
  // transcript 快照
  transcriptParts: new Map<string, string>(),
  errors: [] as string[],
  // SSE 压力指标
  sseStartTime: 0,
  sseBytesTotal: 0,
  sseEventsPerSecond: [] as number[], // 每秒事件数快照
  _secBucket: 0,
  _secCount: 0,
  peakEventsPerSec: 0,
  peakBytesPerSec: 0,
  _bytesSecBucket: 0,
  _bytesSecCount: 0,
}

function countEvent(type: string) {
  stats.eventsTotal++
  stats.eventsByType[type] = (stats.eventsByType[type] || 0) + 1
  const sec = Math.floor((Date.now() - stats.sseStartTime) / 1000)
  if (sec !== stats._secBucket) {
    if (stats._secCount > stats.peakEventsPerSec) stats.peakEventsPerSec = stats._secCount
    stats.sseEventsPerSecond.push(stats._secCount)
    stats._secBucket = sec
    stats._secCount = 0
  }
  stats._secCount++
}

// ── SSE 截获 ──
async function captureSSE(taskID: string, durationMs: number) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), durationMs)

  try {
    const res = await fetch(`${SERVER}/task/${taskID}/events`, {
      headers: headers(),
      signal: controller.signal,
    })
    if (!res.ok || !res.body) {
      stats.errors.push(`SSE connect failed: ${res.status}`)
      return
    }
    stats.sseConnected = true
    stats.sseStartTime = Date.now()
    console.log(`[bench] SSE connected to task ${taskID}`)

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      stats.sseBytesTotal += chunk.length
      // 每秒速率统计
      const sec = Math.floor((Date.now() - stats.sseStartTime) / 1000)
      if (sec !== stats._bytesSecBucket) {
        if (stats._bytesSecCount > stats.peakBytesPerSec) stats.peakBytesPerSec = stats._bytesSecCount
        stats._bytesSecBucket = sec
        stats._bytesSecCount = 0
      }
      stats._bytesSecCount += chunk.length
      buffer += chunk
      const lines = buffer.split("\n")
      buffer = lines.pop() || ""
      for (const line of lines) {
        if (!line.startsWith("data:")) continue
        try {
          const event = JSON.parse(line.slice(5).trim())
          processEvent(event)
        } catch {}
      }
    }
  } catch (e: any) {
    if (e.name !== "AbortError") {
      stats.errors.push(`SSE error: ${e.message}`)
    }
  } finally {
    clearTimeout(timeout)
  }
}

function processEvent(event: any) {
  const type = event.type || ""
  if (type === "task.heartbeat" || type === "task.connected") return
  countEvent(type)

  const payload = event.payload || event.properties || {}

  if (type === "message.updated") {
    stats.messageUpdated++
    const info = payload.info
    if (info) {
      const agentLabel = typeof info.agent === "string" && info.agent ? info.agent : "<missing-agent>"
      console.log(
        `  [msg.updated] id=${info.id?.slice(-8)} role=${info.role} agent=${agentLabel} session=${info.sessionID?.slice(-8)}`,
      )
    }
  }

  if (type === "message.part.updated") {
    stats.partUpdated++
    const part = payload.part
    if (part) {
      const textLen = typeof part.text === "string" ? part.text.length : 0
      console.log(
        `  [part.updated] msg=${part.messageID?.slice(-8)} part=${part.id?.slice(-8)} type=${part.type} text=${textLen}chars`,
      )
      // 记录持久化的 part text
      if (typeof part.text === "string") {
        stats.transcriptParts.set(`${part.messageID}:${part.id}`, part.text)
      }
    }
  }

  if (type === "message.part.delta") {
    stats.partDelta++
    const delta = payload.delta
    if (typeof delta === "string") {
      stats.deltaChars += delta.length
      const key = `${payload.messageID}:${payload.partID}`
      const prev = stats.deltaAccum.get(key) || ""
      stats.deltaAccum.set(key, prev + delta)
    }
    // 每 50 个 delta 打一次进度
    if (stats.partDelta % 50 === 0) {
      console.log(`  [delta] ${stats.partDelta} deltas, ${stats.deltaChars} chars total`)
    }
  }
}

// ── Transcript 快照对比 ──
async function snapshotTranscript(taskID: string) {
  try {
    const messages: any[] = await api(`task/${taskID}/transcript`)
    console.log(`\n[bench] Transcript snapshot: ${messages.length} messages`)
    const parts = new Map<string, string>()
    for (const msg of messages) {
      for (const part of msg.parts || []) {
        if (typeof part.text === "string") {
          parts.set(`${msg.info.id}:${part.id}`, part.text)
        }
      }
    }
    return parts
  } catch (e: any) {
    stats.errors.push(`Transcript fetch failed: ${e.message}`)
    return new Map<string, string>()
  }
}

// ── 主流程 ──
async function main() {
  const taskID = await findTaskID()
  console.log(`[bench] Task: ${taskID}`)
  console.log(`[bench] Server: ${SERVER}`)
  console.log(`[bench] Capturing SSE for 30s...\n`)

  // 先拉一次 transcript 基线
  const baseline = await snapshotTranscript(taskID)
  console.log(`[bench] Baseline: ${baseline.size} text parts\n`)

  // 截获 SSE 30 秒
  await captureSSE(taskID, 30_000)

  // 再拉一次 transcript
  const after = await snapshotTranscript(taskID)

  // ── 报告 ──
  console.log("\n" + "=".repeat(60))
  console.log("BENCHMARK REPORT")
  console.log("=".repeat(60))

  console.log(`\n1. SSE 连接: ${stats.sseConnected ? "✅ 成功" : "❌ 失败"}`)
  console.log(`   总事件数: ${stats.eventsTotal}`)
  console.log(`   事件类型分布:`)
  for (const [type, count] of Object.entries(stats.eventsByType).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${type}: ${count}`)
  }

  // SSE 压力
  const durationSec = Math.max(1, (Date.now() - stats.sseStartTime) / 1000)
  const avgEvtSec = Math.round(stats.eventsTotal / durationSec)
  const avgBytesSec = Math.round(stats.sseBytesTotal / durationSec)
  console.log(`\n2. SSE 压力:`)
  console.log(`   总 bytes: ${stats.sseBytesTotal} (${Math.round(stats.sseBytesTotal / 1024)}KB)`)
  console.log(`   平均: ${avgEvtSec} evt/s, ${Math.round(avgBytesSec / 1024)}KB/s`)
  console.log(`   峰值: ${stats.peakEventsPerSec} evt/s, ${Math.round(stats.peakBytesPerSec / 1024)}KB/s`)
  if (stats.peakEventsPerSec > 200) {
    console.log(`   ⚠️  峰值超 200 evt/s — overlay 16ms 批量可能跟不上`)
  }
  if (stats.peakBytesPerSec > 512 * 1024) {
    console.log(`   ⚠️  峰值超 512KB/s — SSE 可能背压`)
  }

  console.log(`\n3. 消息事件:`)
  console.log(`   message.updated:      ${stats.messageUpdated}`)
  console.log(`   message.part.updated:  ${stats.partUpdated}`)
  console.log(`   message.part.delta:    ${stats.partDelta} (${stats.deltaChars} chars)`)

  const hasStreaming = stats.partDelta > 0
  console.log(`\n4. 流式输出: ${hasStreaming ? "✅ 有 delta 事件" : "❌ 无 delta 事件"}`)

  // 5. Delta 累计 vs transcript 对比
  console.log(`\n5. Delta 累计 vs Transcript 对比:`)
  let deltaMatches = 0
  let deltaMismatches = 0
  let deltaOrphans = 0
  for (const [key, deltaText] of stats.deltaAccum) {
    const transcriptText = after.get(key)
    if (!transcriptText) {
      // delta 累积了但 transcript 里没有 → 可能还没持久化
      deltaOrphans++
      console.log(`   ⚠️  Delta 孤儿 (未持久化): ${key.slice(-20)} delta=${deltaText.length}chars`)
    } else if (transcriptText.endsWith(deltaText) || deltaText.endsWith(transcriptText)) {
      deltaMatches++
    } else {
      deltaMismatches++
      console.log(`   ❌ 不一致: ${key.slice(-20)}`)
      console.log(`      delta:      "${deltaText.slice(-80)}"`)
      console.log(`      transcript: "${transcriptText.slice(-80)}"`)
    }
  }
  console.log(`   匹配: ${deltaMatches}, 不一致: ${deltaMismatches}, 孤儿(未持久化): ${deltaOrphans}`)

  // 6. Transcript 前后对比（syncTask 覆盖检测）
  console.log(`\n6. Transcript 前后变化:`)
  const baselineKeys = new Set(baseline.keys())
  const afterKeys = new Set(after.keys())
  let newParts = 0
  let changedParts = 0
  let removedParts = 0
  for (const key of afterKeys) {
    if (!baselineKeys.has(key)) {
      newParts++
      continue
    }
    if (after.get(key) !== baseline.get(key)) changedParts++
  }
  for (const key of baselineKeys) {
    if (!afterKeys.has(key)) removedParts++
  }
  console.log(`   新增: ${newParts}, 变更: ${changedParts}, 消失: ${removedParts}`)
  if (removedParts > 0) {
    console.log(`   ❌ 有 part 从 transcript 中消失 — syncTask 可能导致消息丢失`)
  }

  // 7. 错误
  if (stats.errors.length > 0) {
    console.log(`\n7. 错误:`)
    for (const err of stats.errors) console.log(`   ❌ ${err}`)
  }

  // ── 结论 ──
  console.log("\n" + "=".repeat(60))
  const issues: string[] = []
  if (!stats.sseConnected) issues.push("SSE 连接失败")
  if (stats.eventsTotal === 0) issues.push("无任何事件到达")
  if (stats.messageUpdated === 0 && stats.partUpdated === 0 && stats.partDelta === 0) issues.push("无消息类事件")
  if (!hasStreaming) issues.push("无流式 delta 事件")
  if (deltaMismatches > 0) issues.push("Delta 与 transcript 不一致")
  if (removedParts > 0) issues.push("Transcript 中有 part 消失")

  if (issues.length === 0) {
    console.log("结论: ✅ 后端事件链路正常")
    console.log("如果 overlay 仍无动态，问题在前端 applyMessageEvent/renderConversation")
  } else {
    console.log("结论: ❌ 发现问题:")
    for (const issue of issues) console.log(`  - ${issue}`)
  }
  console.log("=".repeat(60))
}

main().catch((e) => {
  console.error("Benchmark failed:", e)
  process.exit(1)
})
