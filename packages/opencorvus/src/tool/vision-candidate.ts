import type { CVCandidateItem } from "../opencorvus/perception/cv-candidate"

type Element = {
  id: string
  description: string
  type: string
  coordinates: { x: number; y: number }
  bbox: { x: number; y: number; width: number; height: number } | null
  confidence: number | null
  state?: string | undefined
  candidate_id?: string | null
}

const normalize = (value: string | null | undefined) => value?.trim().toLowerCase() ?? ""

const format = (value: number) => value.toFixed(2)
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

const iou = (
  a: { x: number; y: number; width: number; height: number } | null,
  b: { x: number; y: number; width: number; height: number },
) => {
  if (!a) return 0
  const ax2 = a.x + a.width
  const ay2 = a.y + a.height
  const bx2 = b.x + b.width
  const by2 = b.y + b.height
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x))
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y))
  if (ix <= 0 || iy <= 0) return 0
  const inter = ix * iy
  const aa = Math.max(1, a.width * a.height)
  const bb = Math.max(1, b.width * b.height)
  return inter / Math.max(1, aa + bb - inter)
}

function isNear(item: Element, candidate: CVCandidateItem) {
  const itemSize = item.bbox ? Math.max(item.bbox.width, item.bbox.height) : 0
  const candidateSize = Math.max(candidate.bbox.width, candidate.bbox.height)
  const threshold = clamp(Math.round(Math.max(itemSize, candidateSize) * 0.9 + 24), 36, 180)
  if (dist(item.coordinates, { x: candidate.x, y: candidate.y }) <= threshold) return true
  return iou(item.bbox, candidate.bbox) >= 0.08
}

function nearest(item: Element, candidates: CVCandidateItem[]) {
  if (candidates.length === 0) return null
  let best: CVCandidateItem | null = null
  let d = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    const next = dist(item.coordinates, { x: candidate.x, y: candidate.y })
    if (next >= d) continue
    d = next
    best = candidate
  }
  return best
}

export function applyVisionCandidates(elements: Element[], candidates: CVCandidateItem[]) {
  const map = new Map(candidates.map((item) => [normalize(item.id), item]))
  const used = new Set<string>()
  const items = elements.map((item) => {
    const key = normalize(item.candidate_id)
    const explicit = key ? map.get(key) ?? null : null
    const nearby = nearest(item, candidates)
    const picked = explicit && isNear(item, explicit) ? explicit : nearby && isNear(item, nearby) ? nearby : null
    if (!picked) {
      return { ...item, candidate_id: null }
    }
    used.add(picked.id)
    return {
      ...item,
      candidate_id: picked.id,
      coordinates: {
        x: picked.x,
        y: picked.y,
      },
      bbox: {
        x: picked.bbox.x,
        y: picked.bbox.y,
        width: picked.bbox.width,
        height: picked.bbox.height,
      },
      confidence: item.confidence === null ? picked.score : item.confidence,
    }
  })
  return {
    items,
    used: Array.from(used.values()),
  }
}

export function visionCandidatePrompt(candidates: CVCandidateItem[], limit = 60) {
  if (candidates.length === 0) return ""
  const rows = candidates.slice(0, Math.max(1, limit)).map((item) => {
    return `- ${item.id}: center=(${item.x},${item.y}) bbox=(${item.bbox.x},${item.bbox.y},${item.bbox.width},${item.bbox.height}) score=${format(item.score)}`
  })
  return [
    "## Tool Candidate Anchors (OpenCV, exact coordinates)",
    "These candidates are computed by tool before LLM reasoning.",
    'When an element clearly matches a candidate, optionally set field "candidate_id" to that ID.',
    "Tool also performs automatic nearest-candidate snapping when candidate center/bbox is sufficiently close.",
    "Candidates:",
    ...rows,
  ].join("\n")
}
