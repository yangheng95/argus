#!/usr/bin/env bun

import { createHash } from "node:crypto"
import { generateObject } from "ai"
import z from "zod"
import { Capture } from "../src/opencorvus/perception/capture"
import { CVCandidate } from "../src/opencorvus/perception/cv-candidate"
import { Overlay } from "../src/opencorvus/perception/overlay"
import { WindowManager } from "../src/opencorvus/perception/window"
import { Instance } from "../src/project/instance"
import { Provider } from "../src/provider/provider"
import { visionCandidatePrompt } from "../src/tool/vision-candidate"

const int = (key: string, fallback: number) => {
  const raw = Number(process.env[key] ?? "")
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback
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
const shuffle = <T>(list: T[], next: () => number) => {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1))
    const x = out[i]
    out[i] = out[j]
    out[j] = x
  }
  return out
}
const normalize = (value: string | null | undefined) =>
  value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "") ?? ""

const rounds = int("OPENCORVUS_TARGET_BENCH_ROUNDS", 6)
const marks = int("OPENCORVUS_TARGET_BENCH_MARKERS", 6)
const repeats = int("OPENCORVUS_TARGET_BENCH_REPEATS", 2)
const seed = int("OPENCORVUS_TARGET_BENCH_SEED", 20260305)
const minGap = int("OPENCORVUS_TARGET_BENCH_MIN_GAP", 220)
const outDir = process.env.OPENCORVUS_TARGET_BENCH_OUTDIR ?? ".opencorvus/bench/gui-targetid"
const saveImages = (process.env.OPENCORVUS_TARGET_BENCH_SAVE_IMAGES ?? "1") !== "0"
const style = process.env.OPENCORVUS_TARGET_BENCH_TARGET_STYLE === "click" ? "click" : "big"
const providerOverride = process.env.OPENCORVUS_TARGET_BENCH_PROVIDER ?? ""
const modelOverride = process.env.OPENCORVUS_TARGET_BENCH_MODEL ?? ""
const bindFocused = bool("OPENCORVUS_TARGET_BENCH_BIND_FOCUSED", false)
const bindWindow = (process.env.OPENCORVUS_TARGET_BENCH_BIND_WINDOW ?? "").trim()

const RawResult = z.object({
  points: z.array(
    z.object({
      id: z.string(),
      x: z.number().int().optional(),
      y: z.number().int().optional(),
      confidence: z.number().min(0).max(1).optional(),
    }),
  ),
  note: z.string().optional(),
})

const SnapResult = z.object({
  points: z.array(
    z.object({
      id: z.string(),
      target_id: z.union([z.string(), z.null()]).optional(),
      confidence: z.number().min(0).max(1).optional(),
    }),
  ),
  note: z.string().optional(),
})

const addBigMarker = async (image: Buffer, x: number, y: number, label: string) => {
  const sharp = await import("sharp").then((m) => m.default)
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

const pick = (
  list: Array<{
    id: string
    x: number
    y: number
    bbox: { x: number; y: number; width: number; height: number }
    score: number
  }>,
  count: number,
  gap: number,
) => {
  const ready = list.filter((item) => item.bbox.width >= 12 && item.bbox.height >= 12)
  const out: typeof ready = []
  for (const item of ready) {
    const ok = out.every((prev) => dist(item, prev) >= gap)
    if (!ok) continue
    out.push(item)
    if (out.length >= count) return out
  }
  if (out.length >= count) return out.slice(0, count)
  const seen = new Set(out.map((item) => normalize(item.id)))
  for (const item of ready) {
    const key = normalize(item.id)
    if (seen.has(key)) continue
    out.push(item)
    seen.add(key)
    if (out.length >= count) break
  }
  return out.slice(0, count)
}

const drift = (groups: Map<string, Array<{ x: number; y: number }>>) =>
  Array.from(groups.values())
    .filter((item) => item.length >= 2)
    .map((item) => {
      const mx = mean(item.map((p) => p.x))
      const my = mean(item.map((p) => p.y))
      return mean(item.map((p) => Math.hypot(p.x - mx, p.y - my)))
    })

const metric = (values: Array<number | null>) => values.filter((item): item is number => typeof item === "number")

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

  const inferRaw = async (input: { image: string; prompt: string }) => {
    const attempts = int("OPENCORVUS_TARGET_BENCH_PARSE_RETRY", 3)
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
              content: "You are a GUI coordinate extractor. Return strict JSON only with schema { points:[{id,x,y,confidence?}], note? }.",
            },
            {
              role: "user",
              content: [
                { type: "image" as const, image: input.image },
                { type: "text" as const, text: input.prompt },
              ],
            },
          ],
          schema: RawResult,
        })
        return { data: res.object, error: null as string | null }
      } catch (error) {
        if (n >= attempts) {
          return {
            data: { points: [] as Array<{ id: string; x?: number; y?: number; confidence?: number }>, note: "" },
            error: `${error}`,
          }
        }
      }
    }
    return {
      data: { points: [] as Array<{ id: string; x?: number; y?: number; confidence?: number }>, note: "" },
      error: "unknown",
    }
  }

  const inferSnap = async (input: { image: string; prompt: string }) => {
    const attempts = int("OPENCORVUS_TARGET_BENCH_PARSE_RETRY", 3)
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
              content: "You are a GUI target-id mapper. Return strict JSON only with schema { points:[{id,target_id,confidence?}], note? }.",
            },
            {
              role: "user",
              content: [
                { type: "image" as const, image: input.image },
                { type: "text" as const, text: input.prompt },
              ],
            },
          ],
          schema: SnapResult,
        })
        return { data: res.object, error: null as string | null }
      } catch (error) {
        if (n >= attempts) {
          return {
            data: { points: [] as Array<{ id: string; target_id?: string | null; confidence?: number }>, note: "" },
            error: `${error}`,
          }
        }
      }
    }
    return {
      data: { points: [] as Array<{ id: string; target_id?: string | null; confidence?: number }>, note: "" },
      error: "unknown",
    }
  }

  const rows: Array<{
    round: number
    repeat: number
    id: string
    truth_target_id: string
    truth_x: number
    truth_y: number
    pred_target_id: string | null
    pred_x: number | null
    pred_y: number | null
    raw_error_px: number | null
    raw_error_logical: number | null
    snap_error_px: number | null
    snap_error_logical: number | null
    raw_confidence: number | null
    snap_confidence: number | null
  }> = []
  const rawRepeat = new Map<string, Array<{ x: number; y: number }>>()
  const snapRepeat = new Map<string, Array<{ x: number; y: number }>>()
  const rawMiss: Array<{ round: number; repeat: number; missing: string[]; extra: string[] }> = []
  const snapMiss: Array<{ round: number; repeat: number; missing: string[]; extra: string[] }> = []
  const rawParseFail: Array<{ round: number; repeat: number; message: string }> = []
  const snapParseFail: Array<{ round: number; repeat: number; message: string }> = []
  const skipped: Array<{ round: number; reason: string; candidates: number }> = []
  const scopeCount = { window: 0, monitor: 0 }

  for (let round = 1; round <= rounds; round += 1) {
    const capture = await Capture.take({ mode: "auto" })
    if (capture.scope === "window") scopeCount.window += 1
    if (capture.scope === "monitor") scopeCount.monitor += 1
    const sx = capture.windowBounds?.scaleX ?? 1
    const sy = capture.windowBounds?.scaleY ?? 1

    const all = await CVCandidate.detect(capture.buffer, { max: 80 })
    const shown = shuffle(all, next).slice(0, 60)
    const truth = pick(shown, marks, minGap).map((item, index) => ({
      id: `T${index + 1}`,
      targetID: item.id,
      x: item.x,
      y: item.y,
    }))
    if (truth.length === 0) {
      skipped.push({ round, reason: "no_candidates", candidates: all.length })
      continue
    }

    let rawImage = await Overlay.add(capture.buffer)
    let snapImage = await Overlay.add(capture.buffer)
    snapImage = await Overlay.addCandidates(snapImage, shown, { limit: 60 }).catch(() => snapImage)
    for (const item of truth) {
      rawImage = style === "big"
        ? await addBigMarker(rawImage, item.x, item.y, item.id)
        : await Overlay.addClickMarker(rawImage, item.x, item.y, item.id)
      snapImage = style === "big"
        ? await addBigMarker(snapImage, item.x, item.y, item.id)
        : await Overlay.addClickMarker(snapImage, item.x, item.y, item.id)
    }

    if (saveImages) {
      await Bun.write(`${runDir}/round-${String(round).padStart(2, "0")}-raw.png`, rawImage)
      await Bun.write(`${runDir}/round-${String(round).padStart(2, "0")}-snap.png`, snapImage)
    }

    const idMap = new Map(shown.map((item) => [normalize(item.id), item]))
    const rawBase64 = rawImage.toString("base64")
    const snapBase64 = snapImage.toString("base64")
    const rawHash = createHash("md5").update(rawImage).digest("hex")
    const snapHash = createHash("md5").update(snapImage).digest("hex")
    const ids = truth.map((item) => item.id).join(", ")
    const cvText = visionCandidatePrompt(shown, 60)
    const rawPrompt = [
      "Locate each green marker center by marker label.",
      "Return ONE record per marker id.",
      "Use this JSON shape only:",
      '{"points":[{"id":"T1","x":123,"y":456,"confidence":0.95}],"note":"optional"}',
      "Rules:",
      "- id must be marker label (T1..).",
      "- x,y are best marker center estimate in image pixel coordinates (integer).",
      "- If uncertain, keep best guess and set lower confidence.",
      `Requested marker IDs: ${ids}`,
      `Image size: ${capture.width}x${capture.height}`,
      `Capture scope: ${capture.scope}`,
      `Image hash: ${rawHash}`,
    ].join("\n")
    const snapPrompt = [
      "Map each green marker label (T1/T2/...) to the best candidate target_id.",
      "Return ONE record per marker id.",
      "Use this JSON shape only:",
      '{"points":[{"id":"T1","target_id":"cv_001","confidence":0.95}],"note":"optional"}',
      "Rules:",
      "- id must be marker label (T1..).",
      "- target_id must be one of provided candidate IDs.",
      "- If uncertain, keep best guess and set lower confidence.",
      `Requested marker IDs: ${ids}`,
      `Image size: ${capture.width}x${capture.height}`,
      `Capture scope: ${capture.scope}`,
      `Image hash: ${snapHash}`,
      cvText,
    ].join("\n")

    for (let repeat = 1; repeat <= repeats; repeat += 1) {
      const raw = await inferRaw({ image: rawBase64, prompt: rawPrompt })
      const snap = await inferSnap({ image: snapBase64, prompt: snapPrompt })
      if (raw.error) rawParseFail.push({ round, repeat, message: raw.error })
      if (snap.error) snapParseFail.push({ round, repeat, message: snap.error })

      const gotRaw = new Map(
        raw.data.points.map((item) => [
          normalize(item.id),
          {
            x: typeof item.x === "number" ? item.x : null,
            y: typeof item.y === "number" ? item.y : null,
            confidence: item.confidence ?? null,
          },
        ]),
      )
      const gotSnap = new Map(
        snap.data.points.map((item) => [
          normalize(item.id),
          {
            targetID: item.target_id ?? null,
            confidence: item.confidence ?? null,
          },
        ]),
      )
      const want = truth.map((item) => normalize(item.id))
      const rawIDs = Array.from(gotRaw.keys())
      const snapIDs = Array.from(gotSnap.keys())
      const rawMissing = want.filter((item) => !gotRaw.has(item))
      const rawExtra = rawIDs.filter((item) => !want.includes(item))
      const snapMissing = want.filter((item) => !gotSnap.has(item))
      const snapExtra = snapIDs.filter((item) => !want.includes(item))
      if (rawMissing.length > 0 || rawExtra.length > 0) rawMiss.push({ round, repeat, missing: rawMissing, extra: rawExtra })
      if (snapMissing.length > 0 || snapExtra.length > 0) snapMiss.push({ round, repeat, missing: snapMissing, extra: snapExtra })

      for (const item of truth) {
        const key = normalize(item.id)
        const rawPred = gotRaw.get(key) ?? { x: null, y: null, confidence: null }
        const snapPred = gotSnap.get(key) ?? { targetID: null, confidence: null }
        const rawOk = rawPred.x !== null && rawPred.y !== null
        const rawErrPx = rawOk ? dist({ x: item.x, y: item.y }, { x: rawPred.x!, y: rawPred.y! }) : null
        const rawErrLogical = rawErrPx === null ? null : Math.hypot((rawPred.x! - item.x) / sx, (rawPred.y! - item.y) / sy)

        const snapTarget = snapPred.targetID ? idMap.get(normalize(snapPred.targetID)) : null
        const snapErrPx = snapTarget ? dist({ x: item.x, y: item.y }, { x: snapTarget.x, y: snapTarget.y }) : null
        const snapErrLogical = snapTarget ? Math.hypot((snapTarget.x - item.x) / sx, (snapTarget.y - item.y) / sy) : null

        rows.push({
          round,
          repeat,
          id: item.id,
          truth_target_id: item.targetID,
          truth_x: item.x,
          truth_y: item.y,
          pred_target_id: snapPred.targetID,
          pred_x: rawPred.x,
          pred_y: rawPred.y,
          raw_error_px: rawErrPx,
          raw_error_logical: rawErrLogical,
          snap_error_px: snapErrPx,
          snap_error_logical: snapErrLogical,
          raw_confidence: rawPred.confidence,
          snap_confidence: snapPred.confidence,
        })

        const slot = `${round}:${item.id}`
        if (rawOk) {
          const list = rawRepeat.get(slot) ?? []
          list.push({ x: rawPred.x!, y: rawPred.y! })
          rawRepeat.set(slot, list)
        }
        if (snapTarget) {
          const list = snapRepeat.get(slot) ?? []
          list.push({ x: snapTarget.x, y: snapTarget.y })
          snapRepeat.set(slot, list)
        }
      }
    }
  }

  const total = rows.length
  const idExact = rows.filter((item) => normalize(item.pred_target_id) === normalize(item.truth_target_id)).length

  const rawPx = metric(rows.map((item) => item.raw_error_px))
  const rawLogical = metric(rows.map((item) => item.raw_error_logical))
  const snapPx = metric(rows.map((item) => item.snap_error_px))
  const snapLogical = metric(rows.map((item) => item.snap_error_logical))

  const rawHit5 = rows.filter((item) => item.raw_error_px !== null && item.raw_error_px <= 5).length
  const rawHit10 = rows.filter((item) => item.raw_error_px !== null && item.raw_error_px <= 10).length
  const rawHit20 = rows.filter((item) => item.raw_error_px !== null && item.raw_error_px <= 20).length
  const rawHit40 = rows.filter((item) => item.raw_error_px !== null && item.raw_error_px <= 40).length

  const snapHit5 = rows.filter((item) => item.snap_error_px !== null && item.snap_error_px <= 5).length
  const snapHit10 = rows.filter((item) => item.snap_error_px !== null && item.snap_error_px <= 10).length
  const snapHit20 = rows.filter((item) => item.snap_error_px !== null && item.snap_error_px <= 20).length
  const snapHit40 = rows.filter((item) => item.snap_error_px !== null && item.snap_error_px <= 40).length

  const rawDrift = drift(rawRepeat)
  const snapDrift = drift(snapRepeat)

  const report = {
    config: {
      rounds,
      markersPerRound: marks,
      repeatsPerRound: repeats,
      seed,
      targetStyle: style,
      minGap,
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
    quality: {
      totalExpected: total,
      roundsSkipped: skipped.length,
      skippedSamples: skipped.slice(0, 20),
      parseFailureRateRaw: fixed(rate(rawParseFail.length, Math.max(1, rounds * repeats))),
      parseFailureRateSnap: fixed(rate(snapParseFail.length, Math.max(1, rounds * repeats))),
      idExactRate: fixed(rate(idExact, total)),
      rawMissingOrExtraRounds: rawMiss.length,
      snapMissingOrExtraRounds: snapMiss.length,
    },
    raw_coordinate: {
      matchedRate: fixed(rate(rawPx.length, total)),
      hitAt5px: fixed(rate(rawHit5, total)),
      hitAt10px: fixed(rate(rawHit10, total)),
      hitAt20px: fixed(rate(rawHit20, total)),
      hitAt40px: fixed(rate(rawHit40, total)),
      maePx: fixed(mean(rawPx)),
      p95Px: fixed(pctl(rawPx, 0.95)),
      p99Px: fixed(pctl(rawPx, 0.99)),
      stddevPx: fixed(std(rawPx)),
      maeLogical: fixed(mean(rawLogical)),
      p95Logical: fixed(pctl(rawLogical, 0.95)),
      repeatDriftMaePx: fixed(mean(rawDrift)),
      repeatDriftP95Px: fixed(pctl(rawDrift, 0.95)),
    },
    target_id_snap: {
      matchedRate: fixed(rate(snapPx.length, total)),
      hitAt5px: fixed(rate(snapHit5, total)),
      hitAt10px: fixed(rate(snapHit10, total)),
      hitAt20px: fixed(rate(snapHit20, total)),
      hitAt40px: fixed(rate(snapHit40, total)),
      maePx: fixed(mean(snapPx)),
      p95Px: fixed(pctl(snapPx, 0.95)),
      p99Px: fixed(pctl(snapPx, 0.99)),
      stddevPx: fixed(std(snapPx)),
      maeLogical: fixed(mean(snapLogical)),
      p95Logical: fixed(pctl(snapLogical, 0.95)),
      repeatDriftMaePx: fixed(mean(snapDrift)),
      repeatDriftP95Px: fixed(pctl(snapDrift, 0.95)),
    },
    parseQuality: {
      rawFailures: rawParseFail.length,
      rawSamples: rawParseFail.slice(0, 20),
      snapFailures: snapParseFail.length,
      snapSamples: snapParseFail.slice(0, 20),
    },
    idQuality: {
      rawRoundsWithMissingOrExtraIDs: rawMiss.length,
      rawSamples: rawMiss.slice(0, 20),
      snapRoundsWithMissingOrExtraIDs: snapMiss.length,
      snapSamples: snapMiss.slice(0, 20),
    },
    samples: rows.slice(0, 80),
  }

  const reportPath = `${runDir}/report.json`
  await Bun.write(reportPath, `${JSON.stringify(report, null, 2)}\n`)

  console.log("gui-targetid-benchmark: done")
  console.log(`report: ${reportPath}`)
  console.log(JSON.stringify(report, null, 2))
}

await Instance.provide({
  directory: process.cwd(),
  fn: test,
})
