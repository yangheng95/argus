#!/usr/bin/env bun
/**
 * generate-mascot.ts
 *
 * Generates OpenCorvus mascot and logo images.
 * Primary: DashScope Wanx (wanx2.1-t2i-plus) — excels at anime/chibi style
 * Fallback: OpenAI DALL-E 3
 *
 * Usage:
 *   bun scripts/generate-mascot.ts              # generate all
 *   bun scripts/generate-mascot.ts design-sheet  # generate one by id
 *   bun scripts/generate-mascot.ts --dry-run     # print prompts only
 *
 * Env vars:
 *   DASHSCOPE_API_KEY  (preferred)
 *   OPENAI_API_KEY     (fallback)
 */

import { mkdir, writeFile } from "fs/promises"
import { dirname, resolve } from "path"

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ROOT = resolve(import.meta.dir, "..")
const BRAND_DIR = `${ROOT}/packages/console/app/src/asset/brand`
const LANDER_DIR = `${ROOT}/packages/console/app/src/asset/lander`
const BOT_STICKER_DIR = `${ROOT}/packages/bot/stickers`

// Shared style prefix injected into every prompt
const STYLE_PREFIX = `
chibi anime illustration, flat vector style, clean linework, no gradients,
dark background #0D0B0B,
mascot character "Corvus": tiny cute chibi crow, plump round body, large expressive eyes,
body color very dark charcoal #1A1717 with subtle feather texture,
single left-wing feather highlighted in amber #E8A838,
beak tip amber #E8A838, claw tips amber #E8A838,
brand accent color amber #E8A838 used sparingly,
white highlight dots on eyes, soft shadow under body,
`.trim()

const STYLE_SUFFIX = `
professional product mascot, Pixar-level charm, no text, no watermark,
isolated on dark #0D0B0B background
`.trim()

// ---------------------------------------------------------------------------
// Mascot image definitions
// ---------------------------------------------------------------------------

interface MascotImage {
  id: string
  outPath: string
  size: "1024x1024" | "1024x1792" | "1792x1024"
  description: string
  prompt: string
}

const MASCOT_IMAGES: MascotImage[] = [
  // ── Design sheet (reference / brand kit) ───────────────────────────────
  {
    id: "design-sheet",
    outPath: `${BRAND_DIR}/mascot-ar-design-sheet.png`,
    size: "1024x1024",
    description: "Full design sheet — front/side/back + expressions",
    prompt: `
${STYLE_PREFIX}
Character design sheet showing "Corvus" the chibi crow in five views arranged horizontally:
1. Front view standing upright, wings slightly open, happy expression
2. Side profile view, walking pose
3. Back view, tail feathers fanned out
4. Close-up face panel: happy / thinking / surprised expressions in small circles
5. Color swatch panel: body #1A1717, accent #E8A838, background #0D0B0B
Clean layout on dark background, thin amber separator lines between panels.
${STYLE_SUFFIX}
    `.trim(),
  },

  // ── App icon ────────────────────────────────────────────────────────────
  {
    id: "app-icon",
    outPath: `${BRAND_DIR}/mascot-ar-icon.png`,
    size: "1024x1024",
    description: "App icon — centered bust, suitable for favicon/icon use",
    prompt: `
${STYLE_PREFIX}
Centered bust portrait of "Corvus" the chibi crow,
face filling 70% of frame, slight upward gaze, confident slight smile,
single amber feather on left wing visible at bottom edge,
dark rounded square background #0D0B0B, subtle amber glow halo behind head,
icon-safe composition, high contrast, works at 32px.
${STYLE_SUFFIX}
    `.trim(),
  },

  // ── Working (coding) ────────────────────────────────────────────────────
  {
    id: "working",
    outPath: `${LANDER_DIR}/mascot-ar-working.png`,
    size: "1024x1024",
    description: "Corvus coding — hunched over a tiny glowing terminal",
    prompt: `
${STYLE_PREFIX}
"Corvus" the chibi crow sitting at a tiny glowing terminal/laptop,
hunched forward with focused squinting eyes, one wing typing on keyboard,
amber glow reflecting off face from the screen,
small amber sparks floating around — signs of intense coding activity,
side-angle view showing concentration, coffee cup nearby.
${STYLE_SUFFIX}
    `.trim(),
  },

  // ── Thinking ────────────────────────────────────────────────────────────
  {
    id: "thinking",
    outPath: `${LANDER_DIR}/mascot-ar-thinking.png`,
    size: "1024x1024",
    description: "Corvus in thought — tilted head, floating question marks",
    prompt: `
${STYLE_PREFIX}
"Corvus" the chibi crow standing with head tilted to one side, one wing tip touching chin,
large curious eyes looking upward,
three small amber-colored question marks floating above head,
slight upward curvature of beak suggesting curiosity,
relaxed but engaged pose.
${STYLE_SUFFIX}
    `.trim(),
  },

  // ── Celebrating ─────────────────────────────────────────────────────────
  {
    id: "celebrating",
    outPath: `${LANDER_DIR}/mascot-ar-celebrating.png`,
    size: "1024x1024",
    description: "Corvus celebrating — wings spread, confetti, big smile",
    prompt: `
${STYLE_PREFIX}
"Corvus" the chibi crow with both wings spread wide in celebration,
jumping slightly off ground, eyes closed in joyful crescents,
beak open in a big smile,
small amber sparkles and star confetti bursting outward around the body,
energetic celebratory pose, dynamic motion lines.
${STYLE_SUFFIX}
    `.trim(),
  },

  // ── Alert / Error ───────────────────────────────────────────────────────
  {
    id: "alert",
    outPath: `${LANDER_DIR}/mascot-ar-alert.png`,
    size: "1024x1024",
    description: "Corvus alerting — pointing wing, amber exclamation mark",
    prompt: `
${STYLE_PREFIX}
"Corvus" the chibi crow in alert stance, one wing extended pointing forward,
eyes wide open with raised brow feathers showing urgency,
a single large amber exclamation mark floating beside the head,
slightly leaning forward, feathers slightly ruffled,
not scary — helpful/urgent expression, like a friendly warning.
${STYLE_SUFFIX}
    `.trim(),
  },

  // ── Idle / Waiting ──────────────────────────────────────────────────────
  {
    id: "idle",
    outPath: `${LANDER_DIR}/mascot-ar-idle.png`,
    size: "1024x1024",
    description: "Corvus idle — perched, calm, waiting patiently",
    prompt: `
${STYLE_PREFIX}
"Corvus" the chibi crow perched on a thin branch, wings folded neatly,
relaxed half-lidded eyes, slight content expression,
ambient amber glow dots floating slowly around body like fireflies,
serene waiting pose, peaceful atmosphere,
tail feathers hanging down naturally.
${STYLE_SUFFIX}
    `.trim(),
  },

  // ── Sticker pack (4-up grid) ────────────────────────────────────────────
  {
    id: "sticker-pack",
    outPath: `${BOT_STICKER_DIR}/ar-sticker-pack.png`,
    size: "1024x1024",
    description: "2×2 sticker grid — happy, cool, oops, love",
    prompt: `
${STYLE_PREFIX}
2×2 sticker sheet of "Corvus" the chibi crow, four stickers on dark background:
Top-left: happy Corvus with big smile, arms up, "( ^▽^)" energy
Top-right: cool Corvus wearing tiny amber-tinted sunglasses, confident lean
Bottom-left: oops Corvus, eyes swirling, wing covering mouth apologetically
Bottom-right: love Corvus, eyes as amber hearts, tiny amber hearts floating around
Each sticker has a thin white outline for cut-line visibility,
uniform chibi style across all four.
${STYLE_SUFFIX}
    `.trim(),
  },

  // ── GitHub README hero screenshot ───────────────────────────────────────
  {
    id: "screenshot",
    outPath: `${LANDER_DIR}/screenshot.png`,
    size: "1024x1024",
    description: "README hero — TUI terminal scene with Corvus watching",
    prompt: `
chibi anime illustration, flat vector style, dark background #0D0B0B,
a glowing terminal window floating in the center of the scene,
the terminal shows colorful syntax-highlighted code lines in green and amber,
a blinking amber cursor at the bottom of the terminal,
"Corvus" the chibi crow mascot (tiny plump dark #1A1717 body, amber #E8A838 beak tip and single left-wing feather)
stands to the right of the terminal, looking at it with focused squinting eyes,
one wing tip raised slightly as if pointing at the code,
subtle amber glow from the terminal screen illuminating Corvus's face,
clean minimalist composition, professional developer tool aesthetic,
no text labels, no watermark, dark #0D0B0B background
    `.trim(),
  },

  // ── Social card (OG / Twitter preview) ─────────────────────────────────
  {
    id: "social-card",
    outPath: `${ROOT}/packages/console/app/public/social-share.png`,
    size: "1024x1024",
    description: "Social share card — banner with Corvus + OpenCorvus identity",
    prompt: `
chibi anime illustration, flat vector style,
wide horizontal banner composition on dark #0D0B0B background,
left half: "Corvus" the chibi crow mascot (tiny plump dark #1A1717 body, amber #E8A838 beak tip, single amber-highlighted left-wing feather)
standing upright, confident pose, slight smile, looking slightly right,
surrounded by small floating amber sparkles and code bracket symbols [ ] { },
right half: clean empty dark space with a subtle vertical amber #E8A838 dividing line,
two horizontal amber accent lines in the lower right quadrant,
overall mood: professional, modern, developer-friendly for OpenCorvus,
no text, no watermark, isolated on dark #0D0B0B
    `.trim(),
  },

  // ── Logo mark light (raster) ───────────────────────────────────────────
  {
    id: "logo-mark-light",
    outPath: `${BRAND_DIR}/opencorvus-logo-light.png`,
    size: "1024x1024",
    description: "OpenCorvus logo mark on light background",
    prompt: `
minimal geometric brand mark for OpenCorvus, no text,
inspired by a crow eye and terminal bracket shape, pixel-grid precision,
single centered symbol, strong negative space, no gradients, no shadows,
foreground dark charcoal #211E1E, inner fill #CFCECD,
background clean off-white #F8F7F6,
flat vector look, icon-safe composition, high contrast
    `.trim(),
  },

  // ── Logo mark dark (raster) ────────────────────────────────────────────
  {
    id: "logo-mark-dark",
    outPath: `${BRAND_DIR}/opencorvus-logo-dark.png`,
    size: "1024x1024",
    description: "OpenCorvus logo mark on dark background",
    prompt: `
minimal geometric brand mark for OpenCorvus, no text,
inspired by a crow eye and terminal bracket shape, pixel-grid precision,
single centered symbol, strong negative space, no gradients, no shadows,
foreground warm white #F1ECEC, inner fill #4B4646,
background deep charcoal #0D0B0B,
flat vector look, icon-safe composition, high contrast
    `.trim(),
  },

  // ── Wordmark light (raster) ────────────────────────────────────────────
  {
    id: "wordmark-light",
    outPath: `${BRAND_DIR}/opencorvus-wordmark-light.png`,
    size: "1792x1024",
    description: "OpenCorvus wordmark on light background",
    prompt: `
flat vector logo wordmark, exact lowercase text: "opencorvus",
custom geometric blocky monospace lettering, crisp orthogonal edges,
single-line centered composition, no extra symbols, no subtitle, no watermark,
letter color dark charcoal #211E1E with subtle inner fills #CFCECD,
background off-white #F8F7F6, high contrast, print-ready
    `.trim(),
  },

  // ── Wordmark dark (raster) ─────────────────────────────────────────────
  {
    id: "wordmark-dark",
    outPath: `${BRAND_DIR}/opencorvus-wordmark-dark.png`,
    size: "1792x1024",
    description: "OpenCorvus wordmark on dark background",
    prompt: `
flat vector logo wordmark, exact lowercase text: "opencorvus",
custom geometric blocky monospace lettering, crisp orthogonal edges,
single-line centered composition, no extra symbols, no subtitle, no watermark,
letter color warm white #F1ECEC with inner fills #4B4646,
background deep charcoal #0D0B0B, high contrast, brand-ready
    `.trim(),
  },
]

// ---------------------------------------------------------------------------
// DashScope Wanx API
// ---------------------------------------------------------------------------

const DASHSCOPE_API = "https://dashscope.aliyuncs.com/api/v1"

interface DashScopeTaskResponse {
  request_id: string
  output: { task_id: string; task_status: string }
  code?: string
  message?: string
}

interface DashScopePollResponse {
  output: {
    task_id: string
    task_status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED"
    results?: Array<{ url: string; code?: string; message?: string }>
    task_metrics?: { TOTAL: number; SUCCEEDED: number; FAILED: number }
  }
  usage?: { image_count: number }
  request_id: string
}

async function dashscopeCreate(prompt: string, size: string, apiKey: string): Promise<string> {
  // DashScope Wanx supported sizes (uses '*' separator)
  // Supported: 1024*1024, 720*1280, 1280*720, 768*1024, 1024*768, 768*1152, 1152*768
  const sizeMap: Record<string, string> = {
    "1024x1024": "1024*1024",
    "1024x1792": "720*1280",  // closest portrait
    "1792x1024": "1280*720",  // closest landscape
  }
  const wanxSize = sizeMap[size] ?? "1024*1024"

  const resp = await fetch(`${DASHSCOPE_API}/services/aigc/text2image/image-synthesis`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-DashScope-Async": "enable",
    },
    body: JSON.stringify({
      model: "wanx2.1-t2i-plus",
      input: { prompt },
      parameters: { size: wanxSize, n: 1, style: "anime" },
    }),
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`DashScope create failed ${resp.status}: ${text}`)
  }

  const data = (await resp.json()) as DashScopeTaskResponse
  if (data.code) throw new Error(`DashScope error ${data.code}: ${data.message}`)
  return data.output.task_id
}

async function dashscopePoll(taskId: string, apiKey: string): Promise<string> {
  let delay = 3000
  for (let attempt = 0; attempt < 40; attempt++) {
    await sleep(delay)
    delay = Math.min(delay * 1.5, 15000) // exponential back-off, cap at 15s

    const resp = await fetch(`${DASHSCOPE_API}/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })

    if (!resp.ok) {
      const text = await resp.text()
      throw new Error(`DashScope poll failed ${resp.status}: ${text}`)
    }

    const data = (await resp.json()) as DashScopePollResponse
    const status = data.output.task_status

    if (status === "SUCCEEDED") {
      const url = data.output.results?.[0]?.url
      if (!url) throw new Error("DashScope: SUCCEEDED but no result URL")
      return url
    }

    if (status === "FAILED" || status === "CANCELED") {
      const msg = data.output.results?.[0]?.message ?? status
      throw new Error(`DashScope task ${status}: ${msg}`)
    }

    process.stdout.write(`  ↻ ${status}...`)
  }
  throw new Error("DashScope: timed out waiting for task")
}

async function generateWithDashScope(image: MascotImage, apiKey: string): Promise<string> {
  console.log("  [DashScope] Creating task...")
  const taskId = await dashscopeCreate(image.prompt, image.size, apiKey)
  console.log(`  [DashScope] Task ${taskId} — polling...`)
  const url = await dashscopePoll(taskId, apiKey)
  console.log(`  [DashScope] Done: ${url}`)
  return url
}

// ---------------------------------------------------------------------------
// OpenAI DALL-E 3 fallback
// ---------------------------------------------------------------------------

async function generateWithOpenAI(image: MascotImage, apiKey: string): Promise<string> {
  const dalleSize =
    image.size === "1792x1024" ? "1792x1024" : image.size === "1024x1792" ? "1024x1792" : "1024x1024"

  console.log("  [DALL-E 3] Generating...")
  const resp = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "dall-e-3",
      prompt: image.prompt,
      n: 1,
      size: dalleSize,
      quality: "hd",
      response_format: "url",
    }),
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`DALL-E 3 failed ${resp.status}: ${text}`)
  }

  const data = (await resp.json()) as { data: Array<{ url: string }> }
  const url = data.data[0]?.url
  if (!url) throw new Error("DALL-E 3: no URL in response")
  console.log(`  [DALL-E 3] Done: ${url.slice(0, 80)}...`)
  return url
}

// ---------------------------------------------------------------------------
// Download image
// ---------------------------------------------------------------------------

async function downloadImage(url: string, outPath: string): Promise<void> {
  await mkdir(dirname(outPath), { recursive: true })
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Download failed ${resp.status}: ${url}`)
  const buffer = await resp.arrayBuffer()
  await writeFile(outPath, Buffer.from(buffer))
  const kb = Math.round(buffer.byteLength / 1024)
  console.log(`  Saved → ${outPath} (${kb} KB)`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function processImage(image: MascotImage, dryRun: boolean): Promise<void> {
  console.log(`\n[${"=".repeat(60)}]`)
  console.log(`Image: ${image.id}`)
  console.log(`Output: ${image.outPath}`)
  console.log(`Size: ${image.size}`)
  console.log(`Desc: ${image.description}`)

  if (dryRun) {
    console.log("\n--- PROMPT ---")
    console.log(image.prompt)
    console.log("--- END ---")
    return
  }

  const dashscope = process.env.DASHSCOPE_API_KEY
  const openai = process.env.OPENAI_API_KEY

  let imageUrl: string

  if (dashscope) {
    try {
      imageUrl = await generateWithDashScope(image, dashscope)
    } catch (err) {
      console.error(`  DashScope failed: ${err}`)
      if (!openai) throw new Error("No OPENAI_API_KEY fallback available")
      console.log("  Falling back to DALL-E 3...")
      imageUrl = await generateWithOpenAI(image, openai)
    }
  } else if (openai) {
    imageUrl = await generateWithOpenAI(image, openai)
  } else {
    throw new Error("No API key found. Set DASHSCOPE_API_KEY or OPENAI_API_KEY.")
  }

  await downloadImage(imageUrl, image.outPath)
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes("--dry-run")
  const filter = args.filter((a) => !a.startsWith("--"))

  const targets = filter.length
    ? MASCOT_IMAGES.filter((img) => filter.includes(img.id))
    : MASCOT_IMAGES

  if (filter.length && targets.length === 0) {
    console.error(`No image found with id(s): ${filter.join(", ")}`)
    console.error(`Available ids: ${MASCOT_IMAGES.map((i) => i.id).join(", ")}`)
    process.exit(1)
  }

  console.log(`OpenCorvus Mascot Generator — "Corvus the chibi crow"`)
  console.log(`Mode: ${dryRun ? "DRY RUN (no API calls)" : "LIVE"}`)
  console.log(`Provider: ${process.env.DASHSCOPE_API_KEY ? "DashScope Wanx" : process.env.OPENAI_API_KEY ? "DALL-E 3" : "NONE (set DASHSCOPE_API_KEY)"}`)
  console.log(`Images to generate: ${targets.length}`)

  // Ensure output dirs exist
  if (!dryRun) {
    await mkdir(BRAND_DIR, { recursive: true })
    await mkdir(LANDER_DIR, { recursive: true })
    await mkdir(BOT_STICKER_DIR, { recursive: true })
  }

  const results: Array<{ id: string; status: "ok" | "error"; error?: string }> = []

  for (const image of targets) {
    try {
      await processImage(image, dryRun)
      results.push({ id: image.id, status: "ok" })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`  ERROR: ${msg}`)
      results.push({ id: image.id, status: "error", error: msg })
    }
  }

  // Summary
  console.log(`\n${"=".repeat(62)}`)
  console.log("Summary:")
  for (const r of results) {
    const icon = r.status === "ok" ? "✓" : "✗"
    const detail = r.error ? ` — ${r.error}` : ""
    console.log(`  ${icon} ${r.id}${detail}`)
  }
  const ok = results.filter((r) => r.status === "ok").length
  console.log(`\n${ok}/${results.length} succeeded`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
