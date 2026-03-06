#!/usr/bin/env bun

import { createHash } from "node:crypto"
import { generateObject } from "ai"
import z from "zod"
import { Capture } from "../src/opencorvus/perception/capture"
import { Overlay } from "../src/opencorvus/perception/overlay"
import { WindowManager } from "../src/opencorvus/perception/window"
import { Instance } from "../src/project/instance"
import { Provider } from "../src/provider/provider"

const int = (key: string, fallback: number) => {
  const raw = Number(process.env[key] ?? "")
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback
}
const num = (key: string, fallback: number) => {
  const raw = Number(process.env[key] ?? "")
  return Number.isFinite(raw) && raw > 0 ? raw : fallback
}
const bool = (key: string, fallback = false) => {
  const raw = (process.env[key] ?? "").trim().toLowerCase()
  if (!raw) return fallback
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on"
}
const fixed = (v: number, digits = 4) => Number(v.toFixed(digits))
const mean = (list: number[]) => (list.length === 0 ? 0 : list.reduce((s, x) => s + x, 0) / list.length)
const pctl = (list: number[], p: number) => {
  if (list.length === 0) return 0
  const sorted = [...list].sort((a, b) => a - b)
  const i = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1))
  return sorted[i] ?? 0
}
const std = (list: number[]) => {
  if (list.length === 0) return 0
  const m = mean(list)
  return Math.sqrt(list.reduce((s, x) => s + (x - m) ** 2, 0) / list.length)
}
const rate = (ok: number, total: number) => (total === 0 ? 0 : (ok / total) * 100)
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)
const rng = (seed: number) => {
  let s = seed >>> 0
  return () => {
    s = (1664525 * s + 1013904223) >>> 0
    return s / 4294967296
  }
}
const pick = (next: () => number, min: number, max: number) => Math.floor(min + next() * Math.max(1, max - min + 1))
const normalize = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")

const Result = z.object({
  points: z.array(
    z.object({
      id: z.string(),
      x: z.number().int(),
      y: z.number().int(),
      confidence: z.number().min(0).max(1).optional(),
    }),
  ),
  note: z.string().optional(),
})

const rounds = int("OPENCORVUS_COORD_REAL_ROUNDS", 4)
const marks = int("OPENCORVUS_COORD_REAL_MARKERS", 5)
const repeats = int("OPENCORVUS_COORD_REAL_REPEATS", 2)
const seed = int("OPENCORVUS_COORD_REAL_SEED", 20260305)
const margin = int("OPENCORVUS_COORD_REAL_MARGIN", 180)
const minGap = int("OPENCORVUS_COORD_REAL_MIN_GAP", 240)
const outDir = process.env.OPENCORVUS_COORD_REAL_OUTDIR ?? ".opencorvus/bench/gui-coordinate-real"
const saveImages = (process.env.OPENCORVUS_COORD_REAL_SAVE_IMAGES ?? "1") !== "0"
const style = process.env.OPENCORVUS_COORD_REAL_TARGET_STYLE === "big" ? "big" : "click"
const providerOverride = process.env.OPENCORVUS_COORD_REAL_PROVIDER ?? ""
const modelOverride = process.env.OPENCORVUS_COORD_REAL_MODEL ?? ""
const bindFocused = bool("OPENCORVUS_COORD_REAL_BIND_FOCUSED", false)
const bindWindow = (process.env.OPENCORVUS_COORD_REAL_BIND_WINDOW ?? "").trim()

const addBigMarker = async (image: Buffer, x: number, y: number, label: string) => {
  const sharp = await import("sharp").then((x) => x.default)
  const meta = await sharp(image).metadata()
  const width = meta.width ?? 1
  const height = meta.height ?? 1
  const cx = Math.max(0, Math.min(x, width - 1))
  const cy = Math.max(0, Math.min(y, height - 1))
  const r = Math.max(24, Math.round(Math.max(width, height) / 80))
  const arm = Math.max(36, Math.round(Math.max(width, height) / 45))
  const sw = Math.max(3, Math.round(Math.max(width, height) / 900))
  const font = Math.max(22, Math.round(Math.max(width, height) / 85))
  const char = Math.max(12, Math.round(font * 0.62))
  const boxW = label.length * char + 16
  const boxH = font + 12
  const lx = Math.min(cx + r + 12, width - boxW - 2)
  const ly = Math.max(cy - boxH - 8, 2)
  const svg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${cx}" cy="${cy}" r="${r + 2}" fill="none" stroke="rgba(0,0,0,0.65)" stroke-width="${sw + 2}"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(0,255,0,0.96)" stroke-width="${sw}"/>
      <circle cx="${cx}" cy="${cy}" r="${Math.max(4, Math.round(sw * 1.2))}" fill="rgba(0,255,0,1)"/>
      <line x1="${cx}" y1="${Math.max(0, cy - arm)}" x2="${cx}" y2="${Math.min(height, cy + arm)}" stroke="rgba(0,255,0,0.92)" stroke-width="${sw}"/>
      <line x1="${Math.max(0, cx - arm)}" y1="${cy}" x2="${Math.min(width, cx + arm)}" y2="${cy}" stroke="rgba(0,255,0,0.92)" stroke-width="${sw}"/>
      <rect x="${lx}" y="${ly}" width="${boxW}" height="${boxH}" rx="6" fill="rgba(0,0,0,0.75)"/>
      <text x="${lx + 8}" y="${ly + font}" font-size="${font}" fill="rgba(0,255,0,1)" font-family="monospace">${label}</text>
    </svg>`,
  )
  const out = sharp(image).composite([{ input: svg, top: 0, left: 0 }])
  return meta.format === "jpeg" || meta.format === "jpg" ? out.jpeg({ quality: 95 }).toBuffer() : out.png().toBuffer()
}

const test = async () => {
  const next = rng(seed)
  const def = providerOverride && modelOverride
    ? { providerID: providerOverride, modelID: modelOverride }
    : await Provider.defaultModel()
  const info = await Provider.getModel(def.providerID, def.modelID)
  const model = await Provider.getLanguage(info)
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "")
  const runDir = `${outDir}/${stamp}`

  await Bun.write(`${runDir}/.keep`, "")

  const pickedWindow = bindWindow
    ? await WindowManager.findWindow(bindWindow)
    : bindFocused
      ? (await WindowManager.listWindows(true)).find((item) => item.isFocused && !item.isMinimized) ?? null
      : null
  const binding = pickedWindow ? await WindowManager.bindById(pickedWindow.id, bindWindow || pickedWindow.title) : null

  const rows: Array<{
    round: number
    repeat: number
    id: string
    truthX: number
    truthY: number
    predX: number
    predY: number
    error: number
    confidence: number | null
  }> = []

  const byRepeat = new Map<string, Array<{ x: number; y: number }>>()
  const miss: Array<{ round: number; repeat: number; missing: string[]; extra: string[] }> = []
  const parseFail: Array<{ round: number; repeat: number; message: string }> = []
  const scopeCount = { window: 0, monitor: 0 }

  const infer = async (input: { image: string; prompt: string }) => {
    const attempts = int("OPENCORVUS_COORD_REAL_PARSE_RETRY", 3)
    let n = 0
    while (n < attempts) {
      n += 1
      try {
        const res = await generateObject({
          model,
          temperature: 0,
          messages: [
            {
              role: "system",
              content:
                "You are a coordinate extraction engine. Return strict JSON matching schema { points:[{id,x,y,confidence?}], note? }.",
            },
            {
              role: "user",
              content: [
                { type: "image" as const, image: input.image },
                { type: "text" as const, text: input.prompt },
              ],
            },
          ],
          schema: Result,
        })
        return { data: res.object, error: null as string | null }
      } catch (error) {
        if (n >= attempts) {
          return { data: { points: [] as Array<{ id: string; x: number; y: number; confidence?: number }>, note: "" }, error: `${error}` }
        }
      }
    }
    return { data: { points: [] as Array<{ id: string; x: number; y: number; confidence?: number }>, note: "" }, error: "unknown" }
  }

  for (let round = 1; round <= rounds; round += 1) {
    const capture = await Capture.take({ mode: "auto" })
    if (capture.scope === "window") scopeCount.window += 1
    if (capture.scope === "monitor") scopeCount.monitor += 1
    let image = await Overlay.add(capture.buffer)

    const points: Array<{ id: string; x: number; y: number }> = []
    const tries = marks * 200
    let attempt = 0
    while (points.length < marks && attempt < tries) {
      attempt += 1
      const x = pick(next, margin, Math.max(margin, capture.width - margin - 1))
      const y = pick(next, margin, Math.max(margin, capture.height - margin - 1))
      const ok = points.every((item) => dist(item, { x, y }) >= minGap)
      if (!ok) continue
      points.push({ id: `T${points.length + 1}`, x, y })
    }
    while (points.length < marks) {
      const idx = points.length + 1
      points.push({
        id: `T${idx}`,
        x: pick(next, margin, Math.max(margin, capture.width - margin - 1)),
        y: pick(next, margin, Math.max(margin, capture.height - margin - 1)),
      })
    }

    for (const item of points) {
      image = style === "big" ? await addBigMarker(image, item.x, item.y, item.id) : await Overlay.addClickMarker(image, item.x, item.y, item.id)
    }

    if (saveImages) {
      const imgPath = `${runDir}/round-${String(round).padStart(2, "0")}.png`
      await Bun.write(imgPath, image)
    }

    const base64 = image.toString("base64")
    const hash = createHash("md5").update(image).digest("hex")
    const ids = points.map((item) => item.id).join(", ")
    const prompt = [
      "Read the screenshot and locate the exact center point of each green crosshair marker.",
      "Markers are labeled as plain text near the crosshair.",
      "Return one coordinate pair for each requested ID.",
      'Output STRICT JSON with this shape: {"points":[{"id":"T1","x":123,"y":456,"confidence":0.99}],"note":"optional"}',
      "Rules:",
      "- Use image pixel coordinates (origin top-left).",
      "- Use integer x and y.",
      "- Do not invent IDs that do not exist.",
      "- Include all requested IDs.",
      "- If uncertain, return your best estimate with confidence.",
      `Requested IDs: ${ids}`,
      `Image size: ${capture.width}x${capture.height}`,
      `Capture scope: ${capture.scope}`,
      `Image hash: ${hash}`,
    ].join("\n")

    for (let repeat = 1; repeat <= repeats; repeat += 1) {
      const res = await infer({ image: base64, prompt })
      if (res.error) parseFail.push({ round, repeat, message: res.error })

      const got = new Map(
        res.data.points.map((item) => [
          normalize(item.id),
          { x: item.x, y: item.y, confidence: item.confidence ?? null, raw: item.id },
        ]),
      )

      const want = points.map((item) => normalize(item.id))
      const gotIDs = Array.from(got.keys())
      const missing = want.filter((item) => !got.has(item))
      const extra = gotIDs.filter((item) => !want.includes(item))
      if (missing.length > 0 || extra.length > 0) {
        miss.push({ round, repeat, missing, extra })
      }

      for (const truth of points) {
        const key = normalize(truth.id)
        const pick = got.get(key) ?? { x: -1, y: -1, confidence: null }
        const error = pick.x < 0 || pick.y < 0 ? Number.POSITIVE_INFINITY : dist(truth, pick)
        rows.push({
          round,
          repeat,
          id: truth.id,
          truthX: truth.x,
          truthY: truth.y,
          predX: pick.x,
          predY: pick.y,
          error,
          confidence: pick.confidence,
        })
        const slot = `${round}:${truth.id}`
        const list = byRepeat.get(slot) ?? []
        if (pick.x >= 0 && pick.y >= 0) list.push({ x: pick.x, y: pick.y })
        byRepeat.set(slot, list)
      }
    }
  }

  const ok = rows.filter((item) => Number.isFinite(item.error))
  const err = ok.map((item) => item.error)
  const hit5 = ok.filter((item) => item.error <= 5).length
  const hit10 = ok.filter((item) => item.error <= 10).length
  const hit20 = ok.filter((item) => item.error <= 20).length
  const hit40 = ok.filter((item) => item.error <= 40).length
  const total = rows.length
  const matched = ok.length
  const missing = total - matched

  const drift = Array.from(byRepeat.values())
    .filter((item) => item.length >= 2)
    .map((item) => {
      const mx = mean(item.map((p) => p.x))
      const my = mean(item.map((p) => p.y))
      return mean(item.map((p) => Math.hypot(p.x - mx, p.y - my)))
    })

  const report = {
    config: {
      rounds,
      markersPerRound: marks,
      repeatsPerRound: repeats,
      targetStyle: style,
      seed,
      margin,
      minGap,
      totalExpected: total,
      outputDir: runDir,
      saveImages,
      bindWindowQuery: bindWindow || null,
      bindFocused,
      binding: binding
        ? {
            windowId: binding.windowId,
            title: binding.info.title,
            appName: binding.info.appName,
            width: binding.info.width,
            height: binding.info.height,
          }
        : null,
    },
    model: {
      providerID: def.providerID,
      modelID: def.modelID,
      api: info.api.id,
    },
    capture: {
      windowRate: fixed(rate(scopeCount.window, rounds)),
      monitorRate: fixed(rate(scopeCount.monitor, rounds)),
      windowRounds: scopeCount.window,
      monitorRounds: scopeCount.monitor,
    },
    correctness: {
      matchedRate: fixed(rate(matched, total)),
      missingRate: fixed(rate(missing, total)),
      parseFailureRate: fixed(rate(parseFail.length, rounds * repeats)),
      hitAt5px: fixed(rate(hit5, total)),
      hitAt10px: fixed(rate(hit10, total)),
      hitAt20px: fixed(rate(hit20, total)),
      hitAt40px: fixed(rate(hit40, total)),
      maePx: fixed(mean(err)),
      p95Px: fixed(pctl(err, 0.95)),
      p99Px: fixed(pctl(err, 0.99)),
      stddevPx: fixed(std(err)),
    },
    stability: {
      groupsWithRepeat: drift.length,
      repeatDriftMaePx: fixed(mean(drift)),
      repeatDriftP95Px: fixed(pctl(drift, 0.95)),
    },
    idQuality: {
      roundsWithMissingOrExtraIDs: miss.length,
      samples: miss.slice(0, 20),
    },
    parseQuality: {
      failures: parseFail.length,
      samples: parseFail.slice(0, 20),
    },
    samples: rows.slice(0, 50),
  }

  const reportPath = `${runDir}/report.json`
  await Bun.write(reportPath, `${JSON.stringify(report, null, 2)}\n`)

  console.log("gui-coordinate-real-benchmark: done")
  console.log(`report: ${reportPath}`)
  console.log(JSON.stringify(report, null, 2))
}

await Instance.provide({
  directory: process.cwd(),
  fn: test,
})
