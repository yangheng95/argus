// HTML means HyperText Markup Language. ID means Identifier. JSON means JavaScript Object Notation.
// SHA-256 means Secure Hash Algorithm 256-bit. URL means Uniform Resource Locator.

import { createHash } from "node:crypto"
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  parseMirrorWatchPersonaAuthorityPayload,
  type MirrorWatchPersonaAuthorityPayload,
} from "./persona-authority"
import {
  MIRROR_WATCH_FEATURE_CODES,
  MIRROR_WATCH_VOTE_WEIGHTS,
  validateMirrorWatchExpertVotes,
  type MirrorWatchExpertVote,
} from "./expert-survey"
import {
  assertMirrorWatchPersonaVoteMatchesAuthority,
  type MirrorWatchFeature,
  type MirrorWatchPersonaVote,
} from "./delivery"
export {
  assertMirrorWatchPersonaVoteMatchesAuthority,
  parseMirrorWatchPersonaVote,
  parseMirrorWatchSurveyFeatures,
  type MirrorWatchFeature,
  type MirrorWatchPersonaVote,
} from "./delivery"
import { requireCanonicalProjectRelativePath } from "./project-path"
import { renderMirrorWatchReport, type MirrorWatchReportData, type MirrorWatchSegment } from "./report-template"

const FEATURE_CODES = MIRROR_WATCH_FEATURE_CODES
const VOTE_WEIGHTS = MIRROR_WATCH_VOTE_WEIGHTS
const SEGMENT_ORDERS = {
  tier: ["S", "A", "B", "C", "D"],
  status: ["活跃", "预警", "沉睡"],
  interaction_mode: ["standard", "deep", "click", "concise"],
  usage_freq: ["daily", "weekly", "monthly", "rarely"],
} as const

type SegmentField = keyof typeof SEGMENT_ORDERS

interface AggregationInput {
  personaAuthority: MirrorWatchPersonaAuthorityPayload
  features: MirrorWatchFeature[]
  personaVotes: MirrorWatchPersonaVote[]
  expertVotes: MirrorWatchExpertVote[]
  reportPath: string
}

function fail(message: string): never {
  throw new Error(`Mirror Watch aggregation rejected: ${message}`)
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) fail(`${label} must be a nonempty string`)
  if (value !== value.trim()) fail(`${label} must not contain leading or trailing whitespace`)
  return value
}

function unique(values: readonly string[], label: string) {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) fail(`${label} contains duplicate ${value}`)
    seen.add(value)
  }
}

function projectRelativePath(relativePath: string, label: string) {
  return requireCanonicalProjectRelativePath(relativePath, label, fail)
}

function resolveProjectPath(projectDirectory: string, relativePath: string, label: string) {
  const value = projectRelativePath(relativePath, label)
  const projectRoot = path.resolve(projectDirectory)
  const target = path.resolve(projectRoot, value)
  const relative = path.relative(projectRoot, target)
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return target
  return fail(`${label} must stay inside the active project directory`)
}

function assertInsideProject(projectRoot: string, target: string, label: string) {
  const relative = path.relative(projectRoot, target)
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return
  fail(`${label} resolves outside the active project directory`)
}

function isMissingPathError(error: unknown) {
  return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT"
}

async function canonicalProjectRoot(projectDirectory: string) {
  const lexicalRoot = path.resolve(string(projectDirectory, "project_directory"))
  try {
    const info = await lstat(lexicalRoot)
    if (!info.isDirectory()) fail("project_directory must be a directory")
    if (info.isSymbolicLink()) fail("project_directory must not be a symbolic link or junction")
    return await realpath(lexicalRoot)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Mirror Watch aggregation rejected:")) throw error
    const detail = error instanceof Error ? error.message : String(error)
    return fail(`project_directory cannot be resolved: ${detail}`)
  }
}

async function assertNoLinkedPathComponents(
  projectRoot: string,
  target: string,
  label: string,
  allowMissingTail: boolean,
) {
  assertInsideProject(projectRoot, target, label)
  const relative = path.relative(projectRoot, target)
  let current = projectRoot
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    try {
      const info = await lstat(current)
      if (info.isSymbolicLink()) fail(`${label} must not traverse a symbolic link or junction`)
    } catch (error) {
      if (allowMissingTail && isMissingPathError(error)) return
      if (isMissingPathError(error)) return
      throw error
    }
  }
}

async function readProjectText(projectDirectory: string, relativePath: string, label: string) {
  const absolute = resolveProjectPath(projectDirectory, relativePath, label)
  try {
    await assertNoLinkedPathComponents(projectDirectory, absolute, label, false)
    const canonical = await realpath(absolute)
    assertInsideProject(projectDirectory, canonical, label)
    return await readFile(canonical, "utf8")
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Mirror Watch aggregation rejected:")) throw error
    const detail = error instanceof Error ? error.message : String(error)
    return fail(`${label} cannot be read: ${detail}`)
  }
}

function zeroScores() {
  return Object.fromEntries(FEATURE_CODES.map((code) => [code, 0]))
}

function computeStats(votes: readonly MirrorWatchPersonaVote[]) {
  const score = zeroScores()
  const first = zeroScores()
  const second = zeroScores()
  const third = zeroScores()
  const mention = zeroScores()
  const rankCounts = [first, second, third]
  for (const vote of votes) {
    for (const [rank, code] of vote.picks.entries()) {
      score[code] = score[code]! + VOTE_WEIGHTS[rank]!
      rankCounts[rank]![code] = rankCounts[rank]![code]! + 1
      mention[code] = mention[code]! + 1
    }
  }
  const total = Object.values(score).reduce((sum, value) => sum + value, 0)
  if (total !== votes.length * VOTE_WEIGHTS.reduce((sum, value) => sum + value, 0)) {
    fail(`weighted point total ${total} does not equal ${votes.length * 6}`)
  }
  return { score, first, second, third, mention }
}

function computeSegment(votes: readonly MirrorWatchPersonaVote[], field: SegmentField): MirrorWatchSegment {
  const declared = SEGMENT_ORDERS[field] as readonly string[]
  const counts: Record<string, number> = {}
  const data = Object.fromEntries(declared.map((value) => [value, zeroScores()]))
  for (const vote of votes) {
    const segment = vote[field]
    counts[segment] = (counts[segment] ?? 0) + 1
    for (const [rank, code] of vote.picks.entries()) {
      data[segment]![code] = data[segment]![code]! + VOTE_WEIGHTS[rank]!
    }
  }
  const top1: MirrorWatchSegment["top1"] = {}
  const top3: MirrorWatchSegment["top3"] = {}
  for (const segment of declared) {
    const ranked = FEATURE_CODES.map((code) => ({ code, score: data[segment]![code]! }))
      .filter((row) => row.score > 0)
      .sort((left, right) => right.score - left.score || left.code.localeCompare(right.code))
    top1[segment] = ranked[0] ?? null
    top3[segment] = ranked.slice(0, 3)
  }
  const order: string[] = []
  for (const segment of declared) {
    if ((counts[segment] ?? 0) > 0) order.push(segment)
    else if (!(segment in counts)) counts[segment] = 0
  }
  return {
    order,
    counts,
    data,
    top1,
    top3,
  }
}

function computeBundles(votes: readonly MirrorWatchPersonaVote[]): Array<[string, number]> {
  const counts = new Map<string, number>()
  for (const vote of votes) {
    const selected = [...vote.picks].sort((left, right) => left.localeCompare(right))
    for (let left = 0; left < selected.length; left += 1) {
      for (let right = left + 1; right < selected.length; right += 1) {
        const key = `${selected[left]}+${selected[right]}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
  }
  return [...counts.entries()].sort(([, leftCount], [, rightCount]) => rightCount - leftCount).slice(0, 10)
}

function computeQuotes(votes: readonly MirrorWatchPersonaVote[]) {
  const statusClass: Record<string, string> = {
    活跃: "status-active",
    预警: "status-warn",
    沉睡: "status-sleep",
  }
  const quotes: MirrorWatchReportData["quotes"] = []
  const represented = new Set<string>()
  const ranked = [...votes].sort((left, right) => right.reason.length - left.reason.length)
  for (const vote of ranked) {
    const segment = `${vote.tier}\u0000${vote.status}`
    if (represented.has(segment) && quotes.length >= 3) continue
    represented.add(segment)
    quotes.push({
      user: vote.user,
      tier: vote.tier,
      status: vote.status,
      statusClass: statusClass[vote.status]!,
      mode: vote.interaction_mode,
      pick: vote.picks[0]!,
      text: `"${vote.reason.trim().replace(/^"+|"+$/g, "")}"`,
    })
    if (quotes.length === 6) break
  }
  return quotes
}

function pythonRoundRatioPercentage(numerator: number, denominator: number) {
  const scaled = numerator * 100
  const quotient = Math.floor(scaled / denominator)
  const remainder = scaled % denominator
  if (remainder * 2 === denominator) return quotient % 2 === 0 ? quotient : quotient + 1
  return remainder * 2 < denominator ? quotient : quotient + 1
}

function buildNarrative(
  stats: ReturnType<typeof computeStats>,
  byTier: MirrorWatchSegment,
  bundles: Array<[string, number]>,
  names: Record<string, string>,
  sampleSize: number,
) {
  const ranked = FEATURE_CODES.map((code) => [code, stats.score[code]!] as const).sort(
    (left, right) => right[1] - left[1],
  )
  const [champion, runnerUp, third] = ranked
  const coldest = ranked.at(-1)!
  const mentionPercentage = pythonRoundRatioPercentage(stats.mention[champion![0]]!, sampleSize)
  const kpis = [
    { label: "🏆 综合冠军", code: champion![0], name: names[champion![0]]!, score: champion![1], color: "var(--gold)" },
    { label: "🥈 综合亚军", code: runnerUp![0], name: names[runnerUp![0]]!, score: runnerUp![1], color: "#64748b" },
    { label: "🥉 综合季军", code: third![0], name: names[third![0]]!, score: third![1], color: "#b45309" },
    { label: "❄️ 最冷门", code: coldest[0], name: names[coldest[0]]!, score: coldest[1], color: "var(--text-dim)" },
  ]
  const tldr = [
    `全场综合冠军是 ${champion![0]}（${names[champion![0]]}）：加权得分 ${champion![1]}，提及率 ${mentionPercentage}%，是样本中最强的共识需求。`,
    `${runnerUp![0]}（${names[runnerUp![0]]}）居次：${runnerUp![1]} 分；${third![0]}（${names[third![0]]}）第三（${third![1]} 分），构成第一梯队。`,
    `${coldest[0]}（${names[coldest[0]]}）最冷门（仅 ${coldest[1]} 分）：投入产出比低，建议降级或改造为其他功能的插件。`,
  ]
  const insights: MirrorWatchReportData["insights"] = [
    {
      n: 1,
      text: `${champion![0]} 是全平台加权得分最高的功能`,
      evidence: `加权 ${champion![1]} 分、提及率 ${mentionPercentage}%（首选 ${stats.first[champion![0]]} / 次选 ${stats.second[champion![0]]} / 三选 ${stats.third[champion![0]]}）`,
    },
  ]
  const tierTops = Object.fromEntries(
    byTier.order.map((tier) => [tier, byTier.top1[tier]?.code]).filter((entry) => entry[1] !== undefined),
  )
  if (new Set(Object.values(tierTops)).size > 1) {
    insights.push({
      n: 2,
      text: "不同用户层级的首选功能存在分化",
      evidence: Object.entries(tierTops)
        .map(([tier, code]) => `${tier}→${code}`)
        .join(" / "),
    })
  }
  if (bundles.length > 0) {
    insights.push({
      n: 3,
      text: `最强产品捆绑信号是 ${bundles[0]![0]}`,
      evidence: `${bundles[0]![1]} 人同时选择；其后 ${bundles
        .slice(1, 3)
        .map(([bundle, count]) => `${bundle}(${count})`)
        .join("、")}`,
    })
  }
  const recommendations: MirrorWatchReportData["recommendations"] = [
    {
      priority: "p1",
      badge: "P0 · MUST-SHIP",
      title: `${champion![0]} ${names[champion![0]]}：列为首发主推`,
      why: `综合得分第一（${champion![1]}），提及率 ${mentionPercentage}%，跨人群共识最强。`,
      how: "作为默认主推路径投入最高优先级资源。",
    },
    {
      priority: "p2",
      badge: "P1 · SHIP",
      title: `${runnerUp![0]} ${names[runnerUp![0]]} / ${third![0]} ${names[third![0]]}：第一梯队跟进`,
      why: `分列二三位（${runnerUp![1]} / ${third![1]} 分），有明确人群支撑。`,
      how: "紧随冠军排期；优先与冠军功能做联动。",
    },
    {
      priority: "p4",
      badge: "P3 · DEPRIORITIZE",
      title: `${coldest[0]} ${names[coldest[0]]} 等尾部功能：不做独立入口`,
      why: `${coldest[0]} 仅 ${coldest[1]} 分，尾部功能整体投入产出比低。`,
      how: "改造为主推功能的插件/模板，节省资源投入头部功能打磨。",
    },
  ]
  return { kpis, tldr, insights, recommendations }
}

function buildReport(
  features: readonly MirrorWatchFeature[],
  personaVotes: readonly MirrorWatchPersonaVote[],
  expertVotes: readonly MirrorWatchExpertVote[],
) {
  const stats = computeStats(personaVotes)
  const names = Object.fromEntries(features.map((feature) => [feature.code, feature.title]))
  const byTier = {
    ...computeSegment(personaVotes, "tier"),
    note: "各层级 Top 功能加权分（数据来自 personas.json 层级）。",
  }
  const byStatus = { ...computeSegment(personaVotes, "status"), note: "活跃/预警/沉睡三态的功能偏好。" }
  const byMode = computeSegment(personaVotes, "interaction_mode")
  const byFreq = computeSegment(personaVotes, "usage_freq")
  const bundles = computeBundles(personaVotes)
  const narrative = buildNarrative(stats, byTier, bundles, names, personaVotes.length || 1)
  const report: MirrorWatchReportData = {
    schema_version: 1,
    featNames: names,
    stats,
    byTier,
    byStatus,
    byMode,
    byFreq,
    bundles,
    bundlesNote: "共选组合揭示天然产品捆绑线。",
    quotes: computeQuotes(personaVotes),
    meta: {
      title: "功能期待度调查报告",
      subtitle: `基于 ${personaVotes.length} 位用户画像的加权投票分析`,
      n: personaVotes.length,
      badges: [
        { label: "样本量", value: String(personaVotes.length) },
        { label: "候选功能", value: `${FEATURE_CODES.length} 个` },
        { label: "投票机制", value: "3-2-1 加权" },
        { label: "数据来源", value: "process_answer_aime/*.json" },
      ],
    },
    footnote: [
      `数据说明：本报告来源于 ${personaVotes.length} 份用户画像 Agent 模拟填写的问卷，问卷模板见 dashboard/data/ainvest-h2-feature-survey-agent.md，画像由已激活 Mirror Watch 专家团包内置。加权得分 = 首选×3 + 次选×2 + 三选×1。`,
      "方法论注意：①样本为 Agent 模拟填写而非真实用户，结论应作为方向性输入；②小样本层（如 C 层）稳健性较低；③事件驱动型功能可能因问卷情境被低估。",
    ],
    ...narrative,
    qualitativeExperts: expertVotes.map((vote) => ({
      name: vote.name,
      perspective: vote.persona_source,
      picks: vote.picks,
      confidence: vote.usage_freq,
      reason: vote.reason,
    })),
  }
  return report
}

export async function aggregateMirrorWatchArtifactsForPublication(input: AggregationInput) {
  const personaAuthority = parseMirrorWatchPersonaAuthorityPayload(input.personaAuthority)
  const reportPath = projectRelativePath(input.reportPath, "report_path")
  const features = input.features
  if (features.length !== FEATURE_CODES.length) fail("research Artifact must contain exactly ten F01-F10 features")
  for (const [index, feature] of features.entries()) {
    if (feature.code !== FEATURE_CODES[index]) fail(`research Artifact feature ${index + 1} must be ${FEATURE_CODES[index]}`)
    string(feature.title, `research Artifact.${feature.code}.title`)
  }
  unique(
    features.map((feature) => feature.title),
    "research Artifact feature titles",
  )
  const personas = [...personaAuthority.personas].sort((left, right) => left.name.localeCompare(right.name))

  const personaByName = new Map(personas.map((persona) => [persona.name, persona]))
  if (input.personaVotes.length === 0) fail("persona cohort Artifact must contain at least one vote")
  const personaVotes = input.personaVotes.map((vote, index) => {
    const label = `persona cohort Artifact vote[${index}]`
    const persona = personaByName.get(vote.name)
    if (!persona) fail(`${label} references out-of-authority persona ${vote.name}`)
    assertMirrorWatchPersonaVoteMatchesAuthority(vote, persona, label)
    return vote
  })
  unique(
    personaVotes.map((vote) => vote.name),
    "persona vote names",
  )

  const orderedVotes = [...personaVotes].sort((left, right) => left.name.localeCompare(right.name))
  const orderedExperts = validateMirrorWatchExpertVotes(input.expertVotes)
  const report = buildReport(features, orderedVotes, orderedExperts)
  const html = renderMirrorWatchReport(report)
  const digest = createHash("sha256").update(html, "utf8").digest("hex")
  return {
    artifact: {
      schema_version: 1 as const,
      persona_authority_sha256: personaAuthority.authority_sha256,
      authority_persona_count: personaAuthority.persona_count,
      persona_vote_count: orderedVotes.length,
      expert_vote_count: orderedExperts.length,
      report_path: reportPath,
      report_sha256: digest,
      stats: report.stats,
      byTier: report.byTier,
      byStatus: report.byStatus,
      byMode: report.byMode,
      byFreq: report.byFreq,
      bundles: report.bundles,
      quotes: report.quotes,
    },
    reportHTML: html,
  }
}

export async function materializeMirrorWatchReport(input: {
  projectDirectory: string
  reportPath: string
  reportHTML: string
  reportSHA256: string
}) {
  const projectDirectory = await canonicalProjectRoot(input.projectDirectory)
  const reportPath = projectRelativePath(input.reportPath, "report_path")
  const reportAbsolute = resolveProjectPath(projectDirectory, reportPath, "report_path")
  const reportDirectory = path.dirname(reportAbsolute)
  await assertNoLinkedPathComponents(projectDirectory, reportAbsolute, "report_path", true)
  await mkdir(reportDirectory, { recursive: true })
  await assertNoLinkedPathComponents(projectDirectory, reportDirectory, "report_path", false)
  assertInsideProject(projectDirectory, await realpath(reportDirectory), "report_path")
  try {
    await writeFile(reportAbsolute, input.reportHTML, { encoding: "utf8", flag: "wx" })
    return "created" as const
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") {
      const detail = error instanceof Error ? error.message : String(error)
      return fail(`report_path cannot be created: ${detail}`)
    }
  }
  const existing = await readProjectText(projectDirectory, reportPath, "report_path")
  const existingSHA256 = createHash("sha256").update(existing, "utf8").digest("hex")
  if (existingSHA256 !== input.reportSHA256 || existing !== input.reportHTML) {
    fail(
      `report_path already exists with different bytes: expected SHA-256 ${input.reportSHA256}, received ${existingSHA256}`,
    )
  }
  return "verified_existing" as const
}

export async function aggregateMirrorWatchArtifacts(input: AggregationInput) {
  return (await aggregateMirrorWatchArtifactsForPublication(input)).artifact
}
