/**
 * Image → `ImageAnalysis` — vision-LLM structural inference.
 *
 * Image2code analogue of `mirror/url/extract.ts` (Browser Runtime DOM extraction)
 * and `mirror/figma/fetch-tree.ts` (REST API fetch). Pure function + Zod
 * boundary; no filesystem I/O beyond reading the input image bytes (caller
 * may pass either a path or a pre-loaded Buffer).
 *
 * Adaptations vs `opencode-private/packages/mirror/src/service/image-extract.ts`:
 *   - Streams via AI SDK `streamText` object output instead of `trackedChatCompletion`
 *     (rule 27: streaming-only LLM calls). The SDK's structured-output
 *     channel enforces the schema, so no `extractFencedCode` / `parseJSON` /
 *     `validateAnalysis` defensive parsing.
 *   - Throws `ImageExtractError` (typed) instead of generic Error (rule 1).
 *   - Multi-image merge folds into one `ImageAnalysis` exactly as upstream
 *     did — palettes union, fonts deduped, trees stacked under per-image
 *     wrapper containers so spatial ordering survives.
 *   - No retry loop. The caller (skill / orchestrator) decides retry policy.
 *     Burying retries here would mask real model misconfigurations (wrong
 *     model id, no vision capability, payload too large).
 */

import { readFile } from "node:fs/promises"
import path from "node:path"
import { extname } from "node:path"

import { Output, type LanguageModel, type ModelMessage } from "ai"

import { Log } from "@/util/log"
import {
  withLLMActivity,
  chunkHeartbeatKind,
  DefaultLLMActivityPolicy,
  LLMActivityError,
  type LLMActivityPolicy,
} from "@/llm/activity"
import { streamText } from "@/llm/api"
import { EngineConfig } from "@/engine/config"
import { ImageExtractError } from "../errors"
import {
  ImageAnalysisSchema,
  type ImageAnalysis,
  type ImageElement,
} from "../ir/image-analysis"
import { imageExtractMessages } from "./prompt"

const log = Log.create({ service: "mirror.image.extract" })

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
}

export interface ImageExtractInputImage {
  /** Filesystem path (read inline) or pre-loaded bytes. Path is resolved
   *  against `worktree` if set. */
  path?: string
  data?: Buffer | Uint8Array
  /** Required when `data` is supplied (no extension to infer from). */
  mediaType?: string
}

export interface ImageExtractInput {
  /** One or more reference screenshots. When multiple are supplied each is
   *  analyzed independently and the results merged (palette / fonts unioned,
   *  trees stacked under per-image wrapper containers in input order). */
  images: ImageExtractInputImage[]
  /** Vision-capable language model (caller resolves `Provider.getLanguage`). */
  model: LanguageModel
  /** Optional contextual hint (e.g. "homepage of e-commerce site"). */
  pageHint?: string
  /** Optional UI library name surfaced to the model so it can tag matched
   *  components via `componentHint`. */
  componentLibrary?: string
  /** Sandboxes filesystem reads to this directory. When set, every input
   *  `path` must resolve inside it. */
  worktree?: string
  signal?: AbortSignal
  onProgress?: (msg: string) => void
}

/** Atomic vision-LLM extraction. Returns a single merged `ImageAnalysis`. */
export async function extractImage(input: ImageExtractInput): Promise<ImageAnalysis> {
  if (input.images.length === 0) {
    throw new ImageExtractError({ reason: "no images supplied" })
  }

  const loaded = await Promise.all(
    input.images.map(async (entry, i) => loadImage(entry, input.worktree, i)),
  )

  input.onProgress?.(`Analyzing ${loaded.length} image(s) with vision model`)

  const analyses = await Promise.all(
    loaded.map(async (img, i) => {
      const { system, messages } = imageExtractMessages({
        images: [{ data: img.data, mediaType: img.mediaType }],
        pageHint: input.pageHint,
        componentLibrary: input.componentLibrary,
      })

      let analysis: ImageAnalysis | undefined
      // Capture stream-text fragments so failure logs can show the actual
      // bytes the model produced. Without this, "No object generated"
      // alone cannot distinguish between (a) interleaved reasoning
      // poisoning the JSON channel, (b) output truncation hitting the
      // model's max_tokens, or (c) the provider downgrading to JSON mode
      // and the model returning prose-wrapped JSON.
      let rawTextLen = 0
      let rawTextHead = ""
      let rawTextTail = ""
      const HEAD_BYTES = 800
      const TAIL_BYTES = 800
      const captureRaw = (chunk: string) => {
        rawTextLen += chunk.length
        if (rawTextHead.length < HEAD_BYTES) {
          rawTextHead = (rawTextHead + chunk).slice(0, HEAD_BYTES)
        }
        rawTextTail = (rawTextTail + chunk).slice(-TAIL_BYTES)
      }
      // Independent idle gate. The session-level gate that wraps the
      // outer agent loop (session/processor.ts) is *paused* while a tool
      // executes — vision-LLM streaming runs inside one of those tool
      // calls, so without its own watchdog a stuck provider connection
      // (alibaba-coding-plan-cn was observed sitting on a vision call for
      // 18 minutes in the 2026-04-27 ainvest benchmark) would not trip
      // any timeout until the tool returned. We compose the caller's
      // signal with the gate's own internal abort so either path
      // (caller cancel or provider stall) unwinds the same way.
      const idleMs = (await EngineConfig.get()).activity.session_llm_idle_ms
      // Step 2 transitional policy: maxRetries=0 keeps caller's existing
      // try/catch + ImageExtractError rethrow path the source of truth for
      // failure handling; activity gives us proper terminal events + idle
      // gate + classification in one place. Step 5 will let the activity
      // own retries and remove the per-callsite catch.
      const visionPolicy: LLMActivityPolicy = {
        ...DefaultLLMActivityPolicy,
        idleMs,
        maxRetries: { default: 0 },
      }
      try {
        await withLLMActivity(
          {
            sessionID: `mirror.image.extract:${img.label}`,
            provider: (input.model as { provider?: string })?.provider ?? "unknown",
            model: (input.model as { modelId?: string })?.modelId ?? "unknown",
          },
          visionPolicy,
          input.signal ?? new AbortController().signal,
          async (run) => {
            const result = streamText({
              model: input.model,
              output: Output.object({ schema: ImageAnalysisSchema }),
              system,
              messages: messages as unknown as ModelMessage[],
              abortSignal: run.signal,
              timeoutMs: false,
            })
            // Single drain via fullStream so the structured-output parser and
            // diagnostic capture observe one ordered event stream.
            for await (const part of result.fullStream) {
              run.bump(chunkHeartbeatKind(part as { type?: string }))
              if (part.type === "text-delta") {
                const delta = (part as any).delta ?? (part as any).textDelta ?? ""
                if (typeof delta === "string" && delta) captureRaw(delta)
              } else if (part.type === "error") {
                throw (part as any).error
              }
            }
            analysis = (await result.output) as ImageAnalysis
          },
          () => { /* sink: vision activity events surfaced via log only for now; step 3 wires bus */ },
        )
      } catch (err) {
        const original = err instanceof LLMActivityError ? (err.cause ?? err) : err
        const reason = original instanceof Error ? original.message : String(original)
        const causeMsg =
          original instanceof Error && original.cause instanceof Error ? original.cause.message : undefined
        log.error("image extract: vision-LLM call failed", {
          imagePath: img.label,
          reason,
          cause: causeMsg,
          rawLen: rawTextLen,
          rawHead: rawTextHead,
          rawTail: rawTextTail,
        })
        throw new ImageExtractError({
          reason:
            `vision-LLM call failed for image ${i + 1}/${loaded.length}: ${reason}` +
            (rawTextLen > 0 ? ` [model emitted ${rawTextLen} chars of text-stream; head=${JSON.stringify(rawTextHead.slice(0, 200))}]` : " [model emitted 0 chars on text-stream]"),
          imagePath: img.label,
          cause: causeMsg || reason,
        })
      }

      // Activity returned without throwing → `analysis` was assigned inside
      // the attemptFn closure. TS cannot see through the closure to narrow
      // the outer let, so assert at the boundary instead of restructuring
      // the entire try/catch block.
      if (!analysis) {
        throw new ImageExtractError({
          reason: `vision-LLM call returned without producing an analysis for image ${i + 1}/${loaded.length}`,
          imagePath: img.label,
        })
      }
      input.onProgress?.(`Analyzed image ${i + 1}/${loaded.length}`)
      return analysis
    }),
  )

  return mergeAnalyses(analyses)
}

interface LoadedImage {
  data: Buffer
  mediaType: string
  label: string
}

async function loadImage(
  entry: ImageExtractInputImage,
  worktree: string | undefined,
  index: number,
): Promise<LoadedImage> {
  if (entry.data) {
    if (!entry.mediaType) {
      throw new ImageExtractError({
        reason: `image ${index + 1}: mediaType is required when supplying raw bytes`,
      })
    }
    return {
      data: entry.data instanceof Buffer ? entry.data : Buffer.from(entry.data),
      mediaType: entry.mediaType,
      label: `<bytes #${index + 1}>`,
    }
  }
  if (!entry.path) {
    throw new ImageExtractError({
      reason: `image ${index + 1}: must supply either path or data`,
    })
  }

  const abs = worktree ? path.resolve(worktree, entry.path) : path.resolve(entry.path)
  if (worktree) {
    const root = path.resolve(worktree) + path.sep
    if (!(abs + path.sep).startsWith(root)) {
      throw new ImageExtractError({
        reason: `image path escapes worktree: ${entry.path}`,
        imagePath: entry.path,
      })
    }
  }

  const ext = extname(abs).toLowerCase()
  const mediaType = entry.mediaType ?? MIME_BY_EXT[ext]
  if (!mediaType) {
    throw new ImageExtractError({
      reason: `unsupported image extension "${ext}" (path: ${abs})`,
      imagePath: entry.path,
    })
  }

  let bytes: Buffer
  try {
    bytes = await readFile(abs)
  } catch (err) {
    throw new ImageExtractError({
      reason: `cannot read image at ${abs}: ${err instanceof Error ? err.message : String(err)}`,
      imagePath: entry.path,
    })
  }

  return { data: bytes, mediaType, label: abs }
}

/** Merge per-image analyses into a single `ImageAnalysis`. Single-image
 *  inputs short-circuit to identity. */
function mergeAnalyses(analyses: ImageAnalysis[]): ImageAnalysis {
  if (analyses.length === 1) return analyses[0]

  const merged: ImageAnalysis = {
    description: analyses
      .map((a, i) => `[Image ${i + 1}] ${a.description}`)
      .join(" | "),
    viewport: analyses[0].viewport,
    tokens: { colors: {}, fonts: [], textStyles: [] },
    tree: [],
    confidence: 0,
  }

  const fontSet = new Set<string>()
  let totalConfidence = 0

  for (let i = 0; i < analyses.length; i++) {
    const a = analyses[i]
    Object.assign(merged.tokens.colors, a.tokens.colors)
    for (const f of a.tokens.fonts) fontSet.add(f)
    merged.tokens.textStyles.push(...a.tokens.textStyles)

    if (a.tree.length === 1) {
      const root = a.tree[0]
      merged.tree.push({ ...root, name: root.name || `image-${i + 1}-section` })
    } else {
      const wrapper: ImageElement = {
        name: `image-${i + 1}-section`,
        role: "section",
        bounds: { x: 0, y: 0, w: a.viewport.width, h: a.viewport.height },
        layout: { direction: "vertical" },
        children: a.tree,
      }
      merged.tree.push(wrapper)
    }
    totalConfidence += a.confidence
  }

  merged.tokens.fonts = [...fontSet]
  merged.confidence = totalConfidence / analyses.length
  return merged
}
