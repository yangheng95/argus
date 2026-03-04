#!/usr/bin/env bun

import sharp from "sharp"
import { mkdir, readdir, stat } from "node:fs/promises"
import path from "node:path"

const fmt = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif"])

const help = `Usage:
  bun scripts/compress-screenshot.ts --in <file|dir> [--out <dir>] [--ssim <num>] [--edge <num>] [--dry]

Options:
  --in    Input screenshot file or directory (required)
  --out   Output directory (default: <input>-compressed)
  --ssim  Global SSIM floor (default: 0.995)
  --edge  Edge SSIM floor (default: 0.992)
  --dry   Run analysis only, do not write files

Examples:
  bun scripts/compress-screenshot.ts --in .tmp/shots
  bun scripts/compress-screenshot.ts --in .tmp/shot.png --out .tmp/out --ssim 0.996 --edge 0.994
`

const parse = (argv: string[]) => {
  const cfg = {
    in: "",
    out: "",
    ssim: 0.995,
    edge: 0.992,
    dry: false,
  }
  let i = 0
  while (i < argv.length) {
    const a = argv[i]
    if (a === "--help" || a === "-h") {
      console.log(help)
      process.exit(0)
    }
    if (a === "--dry") {
      cfg.dry = true
      i += 1
      continue
    }
    if (a === "--in") {
      cfg.in = argv[i + 1] ?? ""
      i += 2
      continue
    }
    if (a === "--out") {
      cfg.out = argv[i + 1] ?? ""
      i += 2
      continue
    }
    if (a === "--ssim") {
      cfg.ssim = Number(argv[i + 1] ?? cfg.ssim)
      i += 2
      continue
    }
    if (a === "--edge") {
      cfg.edge = Number(argv[i + 1] ?? cfg.edge)
      i += 2
      continue
    }
    throw new Error(`Unknown arg: ${a}`)
  }
  if (!cfg.in) throw new Error("Missing required --in")
  if (!Number.isFinite(cfg.ssim) || cfg.ssim <= 0 || cfg.ssim > 1) throw new Error("--ssim must be in (0, 1]")
  if (!Number.isFinite(cfg.edge) || cfg.edge <= 0 || cfg.edge > 1) throw new Error("--edge must be in (0, 1]")
  return cfg
}

const read = async (v: Buffer | string) => {
  const x = await sharp(v).toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return {
    d: x.data,
    w: x.info.width,
    h: x.info.height,
  }
}

const luma = (d: Buffer, n: number) => {
  const y = new Float32Array(n)
  let i = 0
  while (i < n) {
    const p = i * 4
    y[i] = 0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]
    i += 1
  }
  return y
}

const mask = (y: Float32Array, w: number, h: number) => {
  const m = new Uint8Array(w * h)
  let c = 0
  let t = 1
  while (t < 4) {
    let s = 0
    let n = 0
    let r = 1
    while (r < h - 1) {
      let x = 1
      while (x < w - 1) {
        const i = r * w + x
        const g = Math.abs(y[i - 1] - y[i + 1]) + Math.abs(y[i - w] - y[i + w])
        s += g
        n += 1
        x += 1
      }
      r += 1
    }
    if (!n) return m
    c = s / n
    t += 1
  }
  let r = 1
  while (r < h - 1) {
    let x = 1
    while (x < w - 1) {
      const i = r * w + x
      const g = Math.abs(y[i - 1] - y[i + 1]) + Math.abs(y[i - w] - y[i + w])
      if (g >= c * 1.35) m[i] = 1
      x += 1
    }
    r += 1
  }
  return m
}

const ssim = (a: Float32Array, b: Float32Array, m?: Uint8Array) => {
  const n = a.length
  let c = 0
  let sx = 0
  let sy = 0
  let i = 0
  while (i < n) {
    if (m && !m[i]) {
      i += 1
      continue
    }
    sx += a[i]
    sy += b[i]
    c += 1
    i += 1
  }
  if (c < 2) return 1
  const mx = sx / c
  const my = sy / c
  let vx = 0
  let vy = 0
  let xy = 0
  i = 0
  while (i < n) {
    if (m && !m[i]) {
      i += 1
      continue
    }
    const dx = a[i] - mx
    const dy = b[i] - my
    vx += dx * dx
    vy += dy * dy
    xy += dx * dy
    i += 1
  }
  const d = c - 1
  const ox = vx / d
  const oy = vy / d
  const oo = xy / d
  const c1 = (0.01 * 255) ** 2
  const c2 = (0.03 * 255) ** 2
  const p = (2 * mx * my + c1) * (2 * oo + c2)
  const q = (mx * mx + my * my + c1) * (ox + oy + c2)
  if (q === 0) return 1
  return p / q
}

const opaque = (d: Buffer, n: number) => {
  let i = 0
  while (i < n) {
    if (d[i * 4 + 3] !== 255) return false
    i += 1
  }
  return true
}

const judge = async (src: Float32Array, m: Uint8Array, w: number, h: number, buf: Buffer) => {
  const r = await read(buf)
  if (r.w !== w || r.h !== h) return { g: 0, e: 0, ok: false }
  const y = luma(r.d, w * h)
  const g = ssim(src, y)
  const e = ssim(src, y, m)
  return { g, e, ok: true }
}

const pick = async (
  cod: string,
  min: number,
  max: number,
  enc: (q: number) => Promise<Buffer>,
  src: Float32Array,
  m: Uint8Array,
  w: number,
  h: number,
  cfg: { ssim: number; edge: number },
) => {
  let l = min
  let r = max
  let best: null | {
    cod: string
    q: number
    ext: string
    buf: Buffer
    g: number
    e: number
    size: number
  } = null
  while (l <= r) {
    const q = Math.floor((l + r) / 2)
    const buf = await enc(q)
    const now = await judge(src, m, w, h, buf)
    if (now.ok && now.g >= cfg.ssim && now.e >= cfg.edge) {
      best = { cod, q, ext: cod === "avif" ? ".avif" : ".webp", buf, g: now.g, e: now.e, size: buf.byteLength }
      r = q - 1
      continue
    }
    l = q + 1
  }
  return best
}

const scan = async (dir: string): Promise<string[]> => {
  const list = await readdir(dir, { withFileTypes: true })
  const sub = await Promise.all(
    list.map(async (x) => {
      const p = path.join(dir, x.name)
      if (x.isDirectory()) return scan(p)
      if (!x.isFile()) return []
      if (!fmt.has(path.extname(x.name).toLowerCase())) return []
      return [p]
    }),
  )
  return sub.flat()
}

const bytes = (v: number) => {
  if (v < 1024) return `${v} B`
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`
  return `${(v / 1024 / 1024).toFixed(2)} MB`
}

const main = async () => {
  const cfg = parse(process.argv.slice(2))
  const abs = path.resolve(cfg.in)
  const st = await stat(abs)
  const files = st.isFile() ? [abs] : await scan(abs)
  if (!files.length) throw new Error("No screenshot files found")

  const root = st.isFile() ? path.dirname(abs) : abs
  const out = cfg.out
    ? path.resolve(cfg.out)
    : path.join(path.dirname(abs), `${path.basename(abs, path.extname(abs))}-compressed`)
  if (!cfg.dry) await mkdir(out, { recursive: true })

  const rep: Array<Record<string, number | string | null>> = []
  let old = 0
  let now = 0

  for (const file of files) {
    const src = Buffer.from(await Bun.file(file).arrayBuffer())
    const srcSize = src.byteLength
    old += srcSize
    const raw = await read(src)
    const n = raw.w * raw.h
    const y = luma(raw.d, n)
    const m = mask(y, raw.w, raw.h)
    const flat = opaque(raw.d, n)

    const base = () => {
      const x = sharp(src)
      if (!flat) return x
      return x.removeAlpha()
    }

    const keep = {
      cod: "keep",
      q: null,
      ext: path.extname(file).toLowerCase(),
      buf: src,
      g: 1,
      e: 1,
      size: srcSize,
    }

    const pngBuf = await base().png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
    const pngFit = await judge(y, m, raw.w, raw.h, pngBuf)
    const png =
      pngFit.ok && pngFit.g >= cfg.ssim && pngFit.e >= cfg.edge
        ? { cod: "png", q: null, ext: ".png", buf: pngBuf, g: pngFit.g, e: pngFit.e, size: pngBuf.byteLength }
        : null

    const webpNl = await pick(
      "webp_nl",
      50,
      100,
      (q) => base().webp({ nearLossless: true, quality: q, effort: 6, smartSubsample: true }).toBuffer(),
      y,
      m,
      raw.w,
      raw.h,
      cfg,
    )

    const webp = await pick(
      "webp",
      60,
      100,
      (q) => base().webp({ quality: q, effort: 6, smartSubsample: true }).toBuffer(),
      y,
      m,
      raw.w,
      raw.h,
      cfg,
    )

    const avif = await pick(
      "avif",
      28,
      80,
      (q) => base().avif({ quality: q, effort: 6, chromaSubsampling: "4:4:4" }).toBuffer(),
      y,
      m,
      raw.w,
      raw.h,
      cfg,
    )

    const all = [keep, png, webpNl, webp, avif].filter((x): x is NonNullable<typeof x> => Boolean(x))
    const best = all.reduce((a, b) => (b.size < a.size ? b : a))
    now += best.size

    const rel = path.relative(root, file)
    const stem = rel.slice(0, rel.length - path.extname(rel).length)
    const dst = path.join(out, `${stem}${best.ext}`)
    if (!cfg.dry) {
      await mkdir(path.dirname(dst), { recursive: true })
      await Bun.write(dst, best.buf)
    }

    const cut = (1 - best.size / srcSize) * 100
    console.log(
      `${rel} | ${path.extname(file).toLowerCase()} -> ${best.ext} | ${bytes(srcSize)} -> ${bytes(best.size)} | ${cut.toFixed(1)}% | ssim=${best.g.toFixed(5)} edge=${best.e.toFixed(5)} ${best.q === null ? "" : `q=${best.q}`}`,
    )
    rep.push({
      file: rel,
      from: path.extname(file).toLowerCase(),
      to: best.ext,
      quality: best.q,
      old_size: srcSize,
      new_size: best.size,
      saved_pct: Number(cut.toFixed(3)),
      ssim: Number(best.g.toFixed(6)),
      edge_ssim: Number(best.e.toFixed(6)),
      codec: best.cod,
    })
  }

  const sum = {
    files: files.length,
    old_size: old,
    new_size: now,
    saved_pct: Number(((1 - now / old) * 100 || 0).toFixed(3)),
  }

  console.log("")
  console.log(`Files: ${sum.files}`)
  console.log(`Size : ${bytes(sum.old_size)} -> ${bytes(sum.new_size)} (${sum.saved_pct}%)`)
  const json = JSON.stringify({ args: cfg, summary: sum, files: rep }, null, 2)
  const dst = path.join(out, "report.json")
  if (cfg.dry) {
    console.log("")
    console.log(json)
    return
  }
  await Bun.write(dst, json)
  console.log(`Report: ${dst}`)
}

await main()
