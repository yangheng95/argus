#!/usr/bin/env bun

import { Coordinates } from "../src/opencorvus/gui/coordinates"

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const rate = (value: number, total: number) => (total === 0 ? 0 : (value / total) * 100)
const mean = (list: number[]) => (list.length === 0 ? 0 : list.reduce((sum, item) => sum + item, 0) / list.length)
const pctl = (list: number[], p: number) => {
  if (list.length === 0) return 0
  const sorted = [...list].sort((a, b) => a - b)
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1))
  return sorted[index] ?? 0
}
const dev = (list: number[]) => {
  if (list.length === 0) return 0
  const m = mean(list)
  return Math.sqrt(list.reduce((sum, item) => sum + (item - m) ** 2, 0) / list.length)
}
const fmt = (value: number, digits = 4) => Number(value.toFixed(digits))
const rng = (seed: number) => {
  let state = seed >>> 0
  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 4294967296
  }
}
const pick = (next: () => number, list: number[]) => list[Math.floor(next() * list.length)] ?? list[0]
const scale = (input: {
  logicalX: number
  logicalY: number
  logicalWidth: number
  logicalHeight: number
  imageWidth: number
  imageHeight: number
}) => {
  const logicalX = Number.isFinite(input.logicalX) ? input.logicalX : 0
  const logicalY = Number.isFinite(input.logicalY) ? input.logicalY : 0
  const logicalWidth = Number.isFinite(input.logicalWidth) ? input.logicalWidth : 0
  const logicalHeight = Number.isFinite(input.logicalHeight) ? input.logicalHeight : 0
  const imageWidth = Number.isFinite(input.imageWidth) && input.imageWidth > 0 ? input.imageWidth : 1
  const imageHeight = Number.isFinite(input.imageHeight) && input.imageHeight > 0 ? input.imageHeight : 1
  const rawScaleX = logicalWidth > 0 ? imageWidth / logicalWidth : 1
  const rawScaleY = logicalHeight > 0 ? imageHeight / logicalHeight : 1
  const scaleX = Number.isFinite(rawScaleX) && rawScaleX > 0 ? rawScaleX : 1
  const scaleY = Number.isFinite(rawScaleY) && rawScaleY > 0 ? rawScaleY : 1

  return {
    x: Math.round(logicalX * scaleX),
    y: Math.round(logicalY * scaleY),
    width: imageWidth,
    height: imageHeight,
    scaleX,
    scaleY,
    logicalX,
    logicalY,
    logicalWidth,
    logicalHeight,
  }
}

const run = (seed: number, samples: number) => {
  const next = rng(seed)
  const scales = [1, 1.25, 1.5, 1.75, 2, 2.5]
  const state = {
    total: samples,
    exact: 0,
    within1: 0,
    clampOk: 0,
    spaceOk: 0,
    repeatOk: 0,
    err: [] as number[],
    jitter: [] as number[],
    unit: { total: 0, exact: 0, err: [] as number[] },
    scaled: { total: 0, exact: 0, err: [] as number[] },
  }

  Array.from({ length: samples }).forEach(() => {
    const logicalX = Math.floor(next() * 2201) - 300
    const logicalY = Math.floor(next() * 1801) - 200
    const logicalWidth = 200 + Math.floor(next() * 2401)
    const logicalHeight = 150 + Math.floor(next() * 1801)
    const scaleX = pick(next, scales)
    const scaleY = pick(next, scales)
    const imageWidth = Math.max(1, Math.round(logicalWidth * scaleX))
    const imageHeight = Math.max(1, Math.round(logicalHeight * scaleY))
    const bounds = scale({
      logicalX,
      logicalY,
      logicalWidth,
      logicalHeight,
      imageWidth,
      imageHeight,
    })
    const x = Math.floor(next() * (bounds.width + 600)) - 300
    const y = Math.floor(next() * (bounds.height + 600)) - 300
    const actual = Coordinates.resolveDetailed(x, y, bounds, "auto")
    const repeat = Coordinates.resolveDetailed(x, y, bounds, "auto")
    const expectedSpace =
      Math.abs((bounds.scaleX ?? 1) - 1) > 0.01 || Math.abs((bounds.scaleY ?? 1) - 1) > 0.01 ? "logical" : "physical"
    const actualSpace = Coordinates.resolveSpace(x, y, bounds, "auto")

    if (actualSpace === expectedSpace) state.spaceOk += 1
    if (
      actual.x === repeat.x &&
      actual.y === repeat.y &&
      actual.clamped === repeat.clamped &&
      actual.clampedX === repeat.clampedX &&
      actual.clampedY === repeat.clampedY
    ) {
      state.repeatOk += 1
    }

    const px = clamp(x, 0, bounds.width - 1)
    const py = clamp(y, 0, bounds.height - 1)
    const pxClamped = px !== x
    const pyClamped = py !== y
    let expectedX = bounds.x + px
    let expectedY = bounds.y + py
    let expectedClampedX = pxClamped
    let expectedClampedY = pyClamped

    if (expectedSpace === "logical") {
      const sx = bounds.scaleX ?? 1
      const sy = bounds.scaleY ?? 1
      const rawX = Math.round(px / sx)
      const rawY = Math.round(py / sy)
      const logicalRelX = clamp(rawX, 0, logicalWidth - 1)
      const logicalRelY = clamp(rawY, 0, logicalHeight - 1)
      expectedX = logicalX + logicalRelX
      expectedY = logicalY + logicalRelY
      expectedClampedX = pxClamped || rawX !== logicalRelX
      expectedClampedY = pyClamped || rawY !== logicalRelY
    }

    const error = Math.abs(actual.x - expectedX) + Math.abs(actual.y - expectedY)
    state.err.push(error)
    if (error === 0) state.exact += 1
    if (error <= 1) state.within1 += 1
    if (actual.clampedX === expectedClampedX && actual.clampedY === expectedClampedY) state.clampOk += 1

    const bucket = expectedSpace === "logical" ? state.scaled : state.unit
    bucket.total += 1
    bucket.err.push(error)
    if (error === 0) bucket.exact += 1

    const jitter = Coordinates.resolveDetailed(x + Math.floor(next() * 5) - 2, y + Math.floor(next() * 5) - 2, bounds, "auto")
    state.jitter.push(Math.abs(jitter.x - actual.x) + Math.abs(jitter.y - actual.y))
  })

  return {
    seed,
    total: state.total,
    exactRate: rate(state.exact, state.total),
    within1Rate: rate(state.within1, state.total),
    clampRate: rate(state.clampOk, state.total),
    spaceRate: rate(state.spaceOk, state.total),
    repeatRate: rate(state.repeatOk, state.total),
    mae: mean(state.err),
    p95: pctl(state.err, 0.95),
    jitterMae: mean(state.jitter),
    jitterP95: pctl(state.jitter, 0.95),
    unitExactRate: rate(state.unit.exact, state.unit.total),
    unitMae: mean(state.unit.err),
    scaledExactRate: rate(state.scaled.exact, state.scaled.total),
    scaledMae: mean(state.scaled.err),
  }
}

const rounds = Math.max(1, Number(process.env.OPENCORVUS_COORD_BENCH_ROUNDS ?? "10"))
const samples = Math.max(1, Number(process.env.OPENCORVUS_COORD_BENCH_SAMPLES ?? "5000"))
const seed = Math.max(1, Number(process.env.OPENCORVUS_COORD_BENCH_SEED ?? "20260305"))
const runs = Array.from({ length: rounds }, (_, index) => run(seed + index * 7919, samples))
const exactSeries = runs.map((item) => item.exactRate)
const within1Series = runs.map((item) => item.within1Rate)
const clampSeries = runs.map((item) => item.clampRate)
const spaceSeries = runs.map((item) => item.spaceRate)
const repeatSeries = runs.map((item) => item.repeatRate)
const maeSeries = runs.map((item) => item.mae)
const p95Series = runs.map((item) => item.p95)
const jitterMaeSeries = runs.map((item) => item.jitterMae)
const jitterP95Series = runs.map((item) => item.jitterP95)
const unitExactSeries = runs.map((item) => item.unitExactRate)
const unitMaeSeries = runs.map((item) => item.unitMae)
const scaledExactSeries = runs.map((item) => item.scaledExactRate)
const scaledMaeSeries = runs.map((item) => item.scaledMae)

const report = {
  config: {
    rounds,
    samplesPerRound: samples,
    totalSamples: rounds * samples,
    seed,
  },
  correctness: {
    exactRateMean: fmt(mean(exactSeries)),
    exactRateStddev: fmt(dev(exactSeries)),
    within1RateMean: fmt(mean(within1Series)),
    clampRateMean: fmt(mean(clampSeries)),
    spaceRateMean: fmt(mean(spaceSeries)),
  },
  stability: {
    repeatRateMean: fmt(mean(repeatSeries)),
    repeatRateStddev: fmt(dev(repeatSeries)),
    maeMean: fmt(mean(maeSeries)),
    maeStddev: fmt(dev(maeSeries)),
    p95Mean: fmt(mean(p95Series)),
    p95Stddev: fmt(dev(p95Series)),
    jitterMaeMean: fmt(mean(jitterMaeSeries)),
    jitterP95Mean: fmt(mean(jitterP95Series)),
  },
  split: {
    unitScaleExactRateMean: fmt(mean(unitExactSeries)),
    unitScaleMaeMean: fmt(mean(unitMaeSeries)),
    scaledExactRateMean: fmt(mean(scaledExactSeries)),
    scaledMaeMean: fmt(mean(scaledMaeSeries)),
  },
}

console.log("gui-coordinate-benchmark: done")
console.log(JSON.stringify(report, null, 2))
