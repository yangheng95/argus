/**
 * Typed errors for mirror tools. Every failure path throws a `NamedError`
 * subclass so callers (skills / orchestrator / tests) can dispatch on
 * `.name` instead of string-matching messages.
 *
 * No fallback: tools never silently swallow these — they propagate up.
 */

import z from "zod"
import { NamedError } from "@opencorvus-ai/util/error"

/** Figma REST API or URL parsing failed. */
export const FigmaFetchError = NamedError.create(
  "MirrorFigmaFetchError",
  z.object({
    figmaUrl: z.string().optional(),
    nodeId: z.string().optional(),
    status: z.number().optional(),
    reason: z.string(),
  }),
)

/** DOM / computed-style extraction from a URL failed. */
export const UrlExtractError = NamedError.create(
  "MirrorUrlExtractError",
  z.object({
    url: z.string(),
    reason: z.string(),
    phase: z.enum(["launch", "navigate", "evaluate", "screenshot", "asset", "close"]).optional(),
  }),
)

/** Compiling an IR (CompressedDesign / ExtractedPage / ImageAnalysis) to XML failed. */
export const CompileError = NamedError.create(
  "MirrorCompileError",
  z.object({
    source: z.enum(["figma", "url", "image"]),
    reason: z.string(),
  }),
)

/** Pattern analysis / scaffold generation failed. */
export const AnalyzeError = NamedError.create(
  "MirrorAnalyzeError",
  z.object({
    reason: z.string(),
  }),
)

/** Vision-LLM image analysis failed (model rejected the payload, returned
 *  malformed JSON, or could not produce a valid `ImageAnalysis`). */
export const ImageExtractError = NamedError.create(
  "MirrorImageExtractError",
  z.object({
    reason: z.string(),
    imagePath: z.string().optional(),
    cause: z.string().optional(),
  }),
)

/** Visual render against an explicit browser URL failed. */
export const RenderError = NamedError.create(
  "MirrorRenderError",
  z.object({
    url: z.string(),
    reason: z.string(),
    phase: z.enum(["launch", "navigate", "evaluate", "screenshot", "close"]).optional(),
  }),
)

/** Image diff / SSIM / pixelmatch failed. */
export const EvaluateError = NamedError.create(
  "MirrorEvaluateError",
  z.object({
    reason: z.string(),
  }),
)
