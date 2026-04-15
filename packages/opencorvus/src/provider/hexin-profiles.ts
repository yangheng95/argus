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

const log = Log.create({ service: "hexin-profiles" })

export interface HexinModelProfile {
  name: string
  family: string
  reasoning: boolean
  attachment: boolean
  image_in: boolean
  pdf_in: boolean
  toolcall: boolean
  context: number
  output: number
}

const DEFAULT_PROFILE: HexinModelProfile = {
  name: "",
  family: "unknown",
  reasoning: false,
  attachment: false,
  image_in: false,
  pdf_in: false,
  toolcall: true,
  context: 128_000,
  output: 16_384,
}

interface Matcher {
  test: (id: string) => boolean
  profile: Omit<HexinModelProfile, "name">
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
  {
    test: (id) => /^gpt-5\.\d+-mini/i.test(id),
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
  // GLM
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
  return trimmed
    .replace(/[-_.]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
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

