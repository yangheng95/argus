/**
 * Capability profiles for Hexin-gateway models.
 *
 * The gateway's /v1/models endpoint only returns {id, object, created, owned_by}
 * — it does not expose capabilities. We maintain a prefix/pattern match table
 * here to assign capabilities at discovery time.
 *
 * Unknown model IDs fall through to a conservative default (toolcall-capable
 * text-only, no reasoning/image/pdf) and log a warning so the table can be
 * updated.
 */
import { Log } from "../util/log"
import { GLM_EVALUATION_TEMPERATURE, THINKING_MODEL_TOP_P } from "./sampling"

const log = Log.create({ service: "hexin-profiles" })

export interface HexinModelProfile {
  name: string
  family: string
  reasoning: boolean
  temperature?: boolean
  attachment: boolean
  image_in: boolean
  pdf_in: boolean
  toolcall: boolean
  interleaved?: false | { field: "reasoning_content" | "reasoning_details" }
  context: number
  input?: number
  output: number
  transform?: {
    sampling?: {
      temperature?: number
      topP?: number
      topK?: number
    }
    options?: Record<string, unknown>
  }
}

const DEFAULT_PROFILE: HexinModelProfile = {
  name: "",
  family: "unknown",
  reasoning: false,
  temperature: true,
  attachment: false,
  image_in: false,
  pdf_in: false,
  toolcall: true,
  interleaved: false,
  context: 128_000,
  output: 16_384,
}

interface Matcher {
  test: (id: string) => boolean
  profile: Omit<HexinModelProfile, "name">
  contractIDs?: readonly string[]
}

const MATCHERS: Matcher[] = [
  // Claude family — reasoning + vision + pdf
  {
    test: (id) => /claude-haiku/i.test(id),
    profile: {
      family: "claude",
      reasoning: false,
      attachment: true,
      image_in: true,
      pdf_in: true,
      toolcall: true,
      context: 200_000,
      output: 16_384,
    },
  },
  {
    test: (id) => /claude-(sonnet|opus)|Claude-\d/i.test(id),
    profile: {
      family: "claude",
      reasoning: true,
      attachment: true,
      image_in: true,
      pdf_in: true,
      toolcall: true,
      context: 200_000,
      output: 16_384,
    },
  },
  // OpenAI GPT family
  // Order matters: specific matchers (mini / nano / codex) first, then the
  // vision-capable GPT-5.x full model, then the generic fallback.
  //
  // The vision capability of the `gpt-5.x` full model (here gpt-5.4) was
  // verified against the hexin gateway on 2026-04-21 with a multimodal
  // image_url payload — HTTP 200 and an accurate description came back, so
  // `image_in: true` is evidence-backed. `pdf_in` and `reasoning` were
  // NOT verified in that probe; keep them false until evidence arrives.
  // mini / nano / codex branches stay conservative for the same reason —
  // each one needs its own probe before flipping its flags.
  {
    test: (id) => /^gpt-5\.4$/i.test(id),
    profile: {
      family: "gpt-5",
      reasoning: false,
      attachment: true,
      image_in: true,
      pdf_in: false,
      toolcall: true,
      context: 1_050_000,
      input: 922_000,
      output: 128_000,
    },
  },
  {
    test: (id) => /^gpt-5\.\d+-mini/i.test(id),
    profile: {
      family: "gpt-5",
      reasoning: false,
      attachment: false,
      image_in: false,
      pdf_in: false,
      toolcall: true,
      context: 400_000,
      input: 272_000,
      output: 128_000,
    },
  },
  {
    test: (id) => /^gpt-5\.\d+-nano/i.test(id),
    profile: {
      family: "gpt-5",
      reasoning: false,
      attachment: false,
      image_in: false,
      pdf_in: false,
      toolcall: true,
      context: 400_000,
      input: 272_000,
      output: 128_000,
    },
  },
  {
    // Only the bare `gpt-5.X` id — no `-chat`, `-preview`, `-2025-xx` etc.
    // Variants were not probed individually and OpenAI has historically
    // differed on chat vs. base vs. preview capability matrices, so leave
    // them to the generic fallback until there is evidence for each.
    test: (id) => /^gpt-5\.\d+$/i.test(id),
    profile: {
      family: "gpt-5",
      reasoning: false,
      attachment: true,
      image_in: true,
      pdf_in: false,
      toolcall: true,
      context: 400_000,
      input: 272_000,
      output: 128_000,
    },
  },
  {
    test: (id) => /^gpt-/i.test(id),
    profile: {
      family: "gpt-5",
      reasoning: false,
      attachment: false,
      image_in: false,
      pdf_in: false,
      toolcall: true,
      context: 128_000,
      output: 16_384,
    },
  },
  // Gemini — image output
  {
    test: (id) => /gemini/i.test(id),
    profile: {
      family: "gemini",
      reasoning: false,
      attachment: true,
      image_in: true,
      pdf_in: false,
      toolcall: true,
      context: 1_000_000,
      output: 8_192,
    },
  },
  // Kimi K2.6: thinking is enabled by default; fixed sampling and
  // reasoning_content round-tripping are required by Moonshot's API contract.
  {
    test: (id) => /(^|\/)kimi-k2\.6$/i.test(id),
    contractIDs: ["kimi-k2.6"],
    profile: {
      family: "kimi",
      reasoning: true,
      temperature: false,
      attachment: false,
      image_in: false,
      pdf_in: false,
      toolcall: true,
      interleaved: { field: "reasoning_content" },
      context: 256_000,
      output: 128_000,
    },
  },
  // Kimi
  {
    test: (id) => /kimi/i.test(id),
    profile: {
      family: "kimi",
      reasoning: false,
      attachment: false,
      image_in: false,
      pdf_in: false,
      toolcall: true,
      context: 200_000,
      output: 16_384,
    },
  },
  // GLM (General Language Model) 5.x defaults to thinking mode and carries
  // preserved reasoning through reasoning_content on OpenAI-compatible APIs.
  {
    test: (id) => /(^|\/)glm-5(?:\.\d+)?$/i.test(id),
    contractIDs: ["glm-5", "glm-5.1"],
    profile: {
      family: "glm",
      reasoning: true,
      attachment: false,
      image_in: false,
      pdf_in: false,
      toolcall: true,
      interleaved: { field: "reasoning_content" },
      context: 200_000,
      output: 128_000,
      transform: {
        sampling: {
          temperature: GLM_EVALUATION_TEMPERATURE,
          topP: THINKING_MODEL_TOP_P,
        },
        options: {
          thinking: {
            type: "enabled",
            clear_thinking: false,
          },
        },
      },
    },
  },
  // GLM (General Language Model)
  {
    test: (id) => /^glm-|\/glm-/i.test(id),
    profile: {
      family: "glm",
      reasoning: false,
      attachment: false,
      image_in: false,
      pdf_in: false,
      toolcall: true,
      context: 128_000,
      output: 16_384,
    },
  },
  // Qwen 3.7 Max runs in thinking mode behind Hexin/LiteLLM and rejects
  // required/object tool_choice. Mark it as reasoning so SessionLoop uses
  // soft tool choice for terminal and structured-output turns.
  {
    test: (id) => /(^|\/)qwen3\.7-max$/i.test(id),
    contractIDs: ["qwen3.7-max"],
    profile: {
      family: "qwen",
      reasoning: true,
      attachment: false,
      image_in: false,
      pdf_in: false,
      toolcall: true,
      interleaved: { field: "reasoning_content" },
      context: 128_000,
      output: 16_384,
    },
  },
  // Qwen
  {
    test: (id) => /qwen/i.test(id),
    profile: {
      family: "qwen",
      reasoning: false,
      attachment: false,
      image_in: false,
      pdf_in: false,
      toolcall: true,
      context: 128_000,
      output: 16_384,
    },
  },
  // Doubao
  {
    test: (id) => /doubao/i.test(id),
    profile: {
      family: "doubao",
      reasoning: false,
      attachment: false,
      image_in: false,
      pdf_in: false,
      toolcall: true,
      context: 128_000,
      output: 16_384,
    },
  },
  // MiniMax
  {
    test: (id) => /minimax/i.test(id),
    profile: {
      family: "minimax",
      reasoning: false,
      attachment: false,
      image_in: false,
      pdf_in: false,
      toolcall: true,
      context: 128_000,
      output: 16_384,
    },
  },
]

function displayName(id: string): string {
  const trimmed = id.replace(/^[^/]+\//, "")
  return trimmed.replace(/[-_.]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function profileFor(id: string): HexinModelProfile {
  for (const matcher of MATCHERS) {
    if (matcher.test(id)) {
      return { ...matcher.profile, name: displayName(id) }
    }
  }
  log.warn("no profile for hexin model — using conservative default", { id })
  return { ...DEFAULT_PROFILE, name: displayName(id) }
}

export function interleavedReasoningProfileContractIDs(): string[] {
  return MATCHERS.flatMap((matcher) =>
    typeof matcher.profile.interleaved === "object" ? Array.from(matcher.contractIDs ?? []) : [],
  )
}

export function interleavedReasoningProfileContractGaps(): string[] {
  return MATCHERS.filter(
    (matcher) => typeof matcher.profile.interleaved === "object" && !matcher.contractIDs?.length,
  ).map((matcher) => matcher.profile.family)
}
