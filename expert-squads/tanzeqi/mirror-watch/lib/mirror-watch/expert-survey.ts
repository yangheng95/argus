// JSON means JavaScript Object Notation. UTF-8 means Unicode Transformation Format 8-bit.

export const MIRROR_WATCH_EXPERT_SURVEY_ARTIFACT_TYPE = "mirror-watch/expert-survey"
export const MIRROR_WATCH_EXPERT_SURVEY_SCHEMA_VERSION = 1
export const MIRROR_WATCH_FEATURE_CODES = Array.from(
  { length: 10 },
  (_, index) => `F${String(index + 1).padStart(2, "0")}`,
)
export const MIRROR_WATCH_VOTE_WEIGHTS = [3, 2, 1] as const
export const MIRROR_WATCH_EXPERT_VOTE_KEYS = [
  "name",
  "type",
  "persona_source",
  "usage_freq",
  "picks",
  "reason",
] as const

const EXPERT_ANALYSIS_HEADINGS = [
  "## 详细推理过程",
  "### 评估框架",
  "### 10 个功能逐项过筛",
  "### Pick 1",
  "### Pick 2",
  "### Pick 3",
  "### 为什么不选另外 7 个",
  "### 诚实边界总声明",
] as const
const USAGE_FREQUENCIES = ["daily", "weekly", "monthly", "rarely"] as const
const POSITIONED_PERSPECTIVE_REFERENCE =
  /(?:01-writings\.md|02-conversations\.md|03-expression-dna\.md|04-external-views\.md|05-decisions\.md|06-timeline\.md)#(?:10|[1-9])\b/gi

export interface MirrorWatchExpertVote {
  name: string
  type: "agent"
  persona_source: string
  usage_freq: string
  picks: string[]
  reason: string
}

export interface MirrorWatchExpertSurveyPayload {
  vote: MirrorWatchExpertVote
  resource_roles: {
    markdown: 0
    html: 1
    data_module: 2
  }
}

function fail(message: string): never {
  throw new Error(`Mirror Watch expert survey rejected: ${message}`)
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`)
  return value as Record<string, unknown>
}

function parseJSON(text: string, label: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return fail(`${label} is not valid JSON: ${detail}`)
  }
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) fail(`${label} must be a nonempty string`)
  if (value !== value.trim()) fail(`${label} must not contain leading or trailing whitespace`)
  return value
}

function usageFrequency(value: unknown, label: string) {
  const result = string(value, label)
  if (!(USAGE_FREQUENCIES as readonly string[]).includes(result)) {
    fail(`${label} must be one of ${USAGE_FREQUENCIES.join(", ")}`)
  }
  return result
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string) {
  const actual = Object.keys(value).sort()
  const canonical = [...expected].sort()
  if (JSON.stringify(actual) !== JSON.stringify(canonical)) {
    fail(`${label} fields must be exactly ${canonical.join(", ")}; received ${actual.join(", ")}`)
  }
}

function unique(values: readonly string[], label: string) {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) fail(`${label} contains duplicate ${value}`)
    seen.add(value)
  }
}

function parsePicks(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length !== MIRROR_WATCH_VOTE_WEIGHTS.length) {
    fail(`${label} must contain exactly three feature IDs`)
  }
  const result = value.map((item, index) => string(item, `${label}[${index}]`))
  unique(result, label)
  for (const [index, code] of result.entries()) {
    if (!MIRROR_WATCH_FEATURE_CODES.includes(code)) {
      fail(`${label}[${index}] must be one of ${MIRROR_WATCH_FEATURE_CODES.join(", ")}`)
    }
  }
  return result
}

function exactHeadingIndexes(reason: string, label: string) {
  const lines = reason.split(/\r?\n/)
  const occurrences = EXPERT_ANALYSIS_HEADINGS.map((heading) => ({
    heading,
    indexes: lines.flatMap((line, index) => (line === heading ? [index] : [])),
  }))
  const issues = occurrences.flatMap(({ heading, indexes }) =>
    indexes.length === 1 ? [] : [`${heading} expected once, found ${indexes.length}`],
  )
  if (issues.length > 0) fail(`${label} heading contract violations: ${issues.join("; ")}`)
  const indexes = occurrences.map(({ indexes }) => indexes[0]!)
  const orderIssues: string[] = []
  for (let index = 1; index < indexes.length; index += 1) {
    if (indexes[index]! <= indexes[index - 1]!) {
      orderIssues.push(`${occurrences[index]!.heading} must follow ${occurrences[index - 1]!.heading}`)
    }
  }
  if (orderIssues.length > 0) fail(`${label} heading order violations: ${orderIssues.join("; ")}`)
  return { lines, indexes }
}

function assertExpertAnalysis(reason: string, selected: readonly string[], label: string) {
  if (Buffer.byteLength(reason, "utf8") < 5_000) fail(`${label} must contain at least 5000 UTF-8 bytes`)
  const { lines, indexes } = exactHeadingIndexes(reason, label)

  const screening = lines.slice(indexes[2]! + 1, indexes[3]!).join("\n")
  const screeningCodes = Array.from(screening.matchAll(/^\|\s*(?:\*\*)?(F\d{2})\b.*\|\s*$/gm), (match) => match[1]!)
  if (JSON.stringify(screeningCodes) !== JSON.stringify(MIRROR_WATCH_FEATURE_CODES)) {
    fail(`${label} screening table must contain exactly one ordered row for every F01-F10 feature`)
  }

  const positionedReferences = new Set<string>()
  for (let rank = 0; rank < selected.length; rank += 1) {
    const section = lines.slice(indexes[3 + rank]! + 1, indexes[4 + rank]!).join("\n")
    if (!section.includes(selected[rank]!)) fail(`${label} Pick ${rank + 1} must identify ${selected[rank]}`)
    for (const field of ["证据链", "推导", "置信度"]) {
      if (!section.includes(field)) fail(`${label} Pick ${rank + 1} must include ${field}`)
    }
    const sectionReferences = Array.from(section.matchAll(POSITIONED_PERSPECTIVE_REFERENCE), (match) =>
      match[0]!.toLowerCase(),
    )
    if (sectionReferences.length === 0) {
      fail(`${label} Pick ${rank + 1} must cite a positioned package perspective item`)
    }
    for (const reference of sectionReferences) positionedReferences.add(reference)
  }
  if (positionedReferences.size < selected.length) {
    fail(`${label} must cite at least three distinct positioned package perspective items across Pick 1-3`)
  }

  const rejected = lines.slice(indexes[6]! + 1, indexes[7]!).join("\n")
  const rejectedMarkers = Array.from(rejected.matchAll(/^(?:[-*+]\s+|\d+[.)]\s+)(?:\*\*)?(F\d{2})\b/gm), (match) => ({
    code: match[1]!,
    index: match.index,
  }))
  const expectedRejected = MIRROR_WATCH_FEATURE_CODES.filter((code) => !selected.includes(code))
  if (JSON.stringify(rejectedMarkers.map((marker) => marker.code)) !== JSON.stringify(expectedRejected)) {
    fail(`${label} must contain one canonical ordered rejection for every unselected feature`)
  }
  for (const [index, marker] of rejectedMarkers.entries()) {
    const block = rejected.slice(marker.index, rejectedMarkers[index + 1]?.index ?? rejected.length)
    if (Buffer.byteLength(block, "utf8") < 80) {
      fail(`${label} rejection for ${marker.code} must contain at least 80 UTF-8 bytes`)
    }
  }

  const honesty = lines.slice(indexes[7]! + 1).join("\n")
  if (!/(?:不是|并非).{0,40}本人|非.{0,40}本人/.test(honesty)) {
    fail(`${label} honesty boundary must disclaim direct expert authorship`)
  }
  if (!/(?:LLM.{0,40}推断|推断.{0,40}LLM)/i.test(honesty)) {
    fail(`${label} honesty boundary must identify LLM inference`)
  }
}

export function parseMirrorWatchExpertVoteMarkdown(text: string, label: string): MirrorWatchExpertVote {
  const blocks = Array.from(text.matchAll(/```json\s*(\{[\s\S]*?\})\s*```/gi), (match) => match[1]!)
  if (blocks.length !== 1) fail(`${label} must contain exactly one fenced JSON vote object`)
  const row = object(parseJSON(blocks[0]!, `${label} vote`), `${label} vote`)
  exactKeys(row, MIRROR_WATCH_EXPERT_VOTE_KEYS, `${label} vote`)
  if (string(row.type, `${label}.type`) !== "agent") fail(`${label}.type must be agent`)
  const parsedUsageFrequency = usageFrequency(row.usage_freq, `${label}.usage_freq`)
  const result: MirrorWatchExpertVote = {
    name: string(row.name, `${label}.name`),
    type: "agent",
    persona_source: string(row.persona_source, `${label}.persona_source`),
    usage_freq: parsedUsageFrequency,
    picks: parsePicks(row.picks, `${label}.picks`),
    reason: string(row.reason, `${label}.reason`),
  }
  assertExpertAnalysis(result.reason, result.picks, `${label}.reason`)
  return result
}

export function validateMirrorWatchExpertVotes(input: readonly MirrorWatchExpertVote[]) {
  if (input.length !== 2) fail(`expert Artifacts must contain exactly two votes; received ${input.length}`)
  unique(
    input.map((vote) => vote.name),
    "expert vote names",
  )
  unique(
    input.map((vote) => vote.persona_source),
    "expert perspective sources",
  )
  const expectedExpertNames: Record<string, string> = {
    "denis-globa-perspective": "Denis Globa",
    "oleg-mukhanov-perspective": "Oleg Mukhanov",
  }
  const expectedPerspectives = Object.keys(expectedExpertNames).sort((left, right) => left.localeCompare(right))
  const actualPerspectives = input.map((vote) => vote.persona_source).sort((left, right) => left.localeCompare(right))
  if (JSON.stringify(actualPerspectives) !== JSON.stringify(expectedPerspectives)) {
    fail(`expert perspective sources must be exactly ${expectedPerspectives.join(", ")}`)
  }
  for (const vote of input) {
    if (vote.name !== expectedExpertNames[vote.persona_source]) {
      fail(`expert ${vote.persona_source} name must be ${expectedExpertNames[vote.persona_source]}`)
    }
  }
  return [...input].sort(
    (left, right) => left.persona_source.localeCompare(right.persona_source) || left.name.localeCompare(right.name),
  )
}

export function parseMirrorWatchExpertSurveyPayload(value: unknown, label: string): MirrorWatchExpertSurveyPayload {
  const payload = object(value, label)
  exactKeys(payload, ["vote", "resource_roles"], label)
  const vote = object(payload.vote, `${label}.vote`)
  exactKeys(vote, MIRROR_WATCH_EXPERT_VOTE_KEYS, `${label}.vote`)
  const parsedVote: MirrorWatchExpertVote = {
    name: string(vote.name, `${label}.vote.name`),
    type: string(vote.type, `${label}.vote.type`) === "agent" ? "agent" : fail(`${label}.vote.type must be agent`),
    persona_source: string(vote.persona_source, `${label}.vote.persona_source`),
    usage_freq: usageFrequency(vote.usage_freq, `${label}.vote.usage_freq`),
    picks: parsePicks(vote.picks, `${label}.vote.picks`),
    reason: string(vote.reason, `${label}.vote.reason`),
  }
  assertExpertAnalysis(parsedVote.reason, parsedVote.picks, `${label}.vote.reason`)
  const roles = object(payload.resource_roles, `${label}.resource_roles`)
  exactKeys(roles, ["markdown", "html", "data_module"], `${label}.resource_roles`)
  if (roles.markdown !== 0 || roles.html !== 1 || roles.data_module !== 2) {
    fail(`${label}.resource_roles must equal markdown=0, html=1, data_module=2`)
  }
  return {
    vote: parsedVote,
    resource_roles: {
      markdown: 0,
      html: 1,
      data_module: 2,
    },
  }
}
