#!/usr/bin/env bun

import { createHash } from "node:crypto"
import { Capture } from "../src/opencorvus/perception/capture"
import { CVCandidate } from "../src/opencorvus/perception/cv-candidate"
import { Overlay } from "../src/opencorvus/perception/overlay"
import { WindowManager } from "../src/opencorvus/perception/window"
import { Instance } from "../src/project/instance"

const int = (key: string, fallback: number) => {
  const raw = Number(process.env[key] ?? "")
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback
}
const bool = (key: string, fallback = false) => {
  const raw = (process.env[key] ?? "").trim().toLowerCase()
  if (!raw) return fallback
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on"
}

const outRoot = process.env.OPENCORVUS_VISION_PAYLOAD_OUTDIR ?? ".opencorvus/bench/vision-payload"
const bindFocused = bool("OPENCORVUS_VISION_PAYLOAD_BIND_FOCUSED", false)
const bindWindow = (process.env.OPENCORVUS_VISION_PAYLOAD_BIND_WINDOW ?? "").trim()
const candidateMax = int("OPENCORVUS_VISION_PAYLOAD_CANDIDATE_MAX", 80)
const candidateOverlay = bool("OPENCORVUS_VISION_CANDIDATE_OVERLAY", false)
const candidateOverlayLimit = int("OPENCORVUS_VISION_CANDIDATE_OVERLAY_LIMIT", 24)

const run = async () => {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "")
  const dir = `${outRoot}/${stamp}`
  await Bun.write(`${dir}/.keep`, "")

  const picked = bindWindow
    ? await WindowManager.findWindow(bindWindow)
    : bindFocused
      ? (await WindowManager.listWindows(true)).find((item) => item.isFocused && !item.isMinimized) ?? null
      : null
  const binding = picked ? await WindowManager.bindById(picked.id, bindWindow || picked.title) : null

  const capture = await Capture.take({ mode: "auto" })
  const candidates = await CVCandidate.detect(capture.buffer, { max: candidateMax })
  const grid = await Overlay.add(capture.buffer)
  const payload =
    candidateOverlay && candidates.length > 0
      ? await Overlay.addCandidates(grid, candidates, { limit: candidateOverlayLimit }).catch(() => grid)
      : grid

  await Promise.all([
    Bun.write(`${dir}/raw.png`, capture.buffer),
    Bun.write(`${dir}/payload.png`, payload),
    Bun.write(`${dir}/candidates.json`, `${JSON.stringify(candidates, null, 2)}\n`),
    Bun.write(
      `${dir}/meta.json`,
      `${JSON.stringify(
        {
          width: capture.width,
          height: capture.height,
          scope: capture.scope,
          screenshotHash: createHash("md5").update(capture.buffer).digest("hex"),
          candidateCount: candidates.length,
          candidateOverlay,
          candidateOverlayLimit,
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
        null,
        2,
      )}\n`,
    ),
  ])

  console.log("gui-vision-payload-dump: done")
  console.log(`dir: ${dir}`)
  console.log(`payload: ${dir}/payload.png`)
  console.log(`raw: ${dir}/raw.png`)
  console.log(`candidates: ${dir}/candidates.json`)
}

await Instance.provide({
  directory: process.cwd(),
  fn: run,
})

