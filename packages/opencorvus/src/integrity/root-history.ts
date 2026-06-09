import { createHash } from "node:crypto"
import { listIntegrityAttemptArtifacts } from "@/engine/store"
import { canonicalIntegritySymptom, defaultIntegrityVerify, integrityFindingFingerprint } from "./finding-manifest"
import type { IntegrityPriorAttemptSummary, SpecSnapshotLineage } from "./replay-context"
import { getSharedIntegrityPromptBudget, sanitizeIntegrityPromptText } from "./shared-prompt"

export type IntegrityRootSymptomVariation = {
  attemptNumber: number
  artifactID: string
  findingID: string
  fingerprint: string
  rootID: string
  canonicalLabel: string
  canonicalSymptom: string
  severity: "blocking" | "advisory"
  title: string
  description: string
  repair: string
  verify: string[]
  evidence: string[]
  reviewerIDs: string[]
  filePaths: string[]
  requirementIDs: string[]
  specIDs: string[]
}

export type IntegrityPersistentRoot = {
  rootID: string
  canonicalLabel: string
  reviewerIDs: string[]
  firstSeenAttempt: number
  latestSeenAttempt: number
  consecutiveAttempts: number[]
  symptomVariations: IntegrityRootSymptomVariation[]
  latestSeverity: "blocking" | "advisory"
}

export type IntegrityRootHistoryAttempt = IntegrityPriorAttemptSummary & {
  blockingRootLabels: string[]
}

export type IntegrityRootHistory = {
  taskID: string
  specSnapshotLineage: SpecSnapshotLineage
  totalAttempts: number
  attempts: IntegrityRootHistoryAttempt[]
  persistentBlockingRoots: IntegrityPersistentRoot[]
  latestBlockingFindings: IntegrityRootSymptomVariation[]
  latestAdvisoryFindings: IntegrityRootSymptomVariation[]
}

type RootDraft = {
  key: string
  canonicalLabel: string
  reviewerIDs: Set<string>
  attemptNumbers: Set<number>
  symptomVariations: IntegrityRootSymptomVariation[]
  latestSeverity: "blocking" | "advisory"
}

type FindingSummary = IntegrityPriorAttemptSummary["blockingFindings"][number] & {
  severity: "blocking" | "advisory"
  fingerprint: string
  canonicalSymptom: string
  evidence: string[]
  reviewerIDs: string[]
  verify: string[]
}

export function buildIntegrityRootHistory(input: {
  taskID: string
  specSnapshotLineage: SpecSnapshotLineage
  phase?: "pre_build" | "post_build"
}): IntegrityRootHistory {
  if (input.taskID !== input.specSnapshotLineage.taskID) {
    throw new Error(
      `IntegrityRootHistory taskID ${input.taskID} does not match lineage taskID ${input.specSnapshotLineage.taskID}.`,
    )
  }

  const rows = listIntegrityAttemptArtifacts({
    taskID: input.taskID,
    lineage: input.specSnapshotLineage,
    phase: input.phase,
  })
  const chronologicalRows = rows.slice().reverse()
  const rootDrafts = new Map<string, RootDraft>()
  const attempts: IntegrityRootHistoryAttempt[] = []
  let latestAdvisoryFindings: IntegrityRootSymptomVariation[] = []

  chronologicalRows.forEach((row, index) => {
    const payload = asRecord(row.payload)
    const attemptNumber = index + 1
    const reviewers = reviewerSummaries(payload.reviewers)
    const findings = findingSummaries(payload.findings)
    const blockingFindings = findings.filter((finding) => finding.severity === "blocking")
    const advisoryFindings = findings.filter((finding) => finding.severity === "advisory")
    const blockingRootLabels: string[] = []

    for (const finding of blockingFindings) {
      const rootKey = rootGroupingKey(finding)
      const canonicalLabel = canonicalRootLabel(finding)
      const variation = symptomVariation({
        finding,
        rootKey,
        canonicalLabel,
        attemptNumber,
        artifactID: row.artifactID,
        reviewers,
      })
      const draft = rootDrafts.get(rootKey) ?? {
        key: rootKey,
        canonicalLabel,
        reviewerIDs: new Set<string>(),
        attemptNumbers: new Set<number>(),
        symptomVariations: [],
        latestSeverity: finding.severity,
      }
      for (const reviewer of reviewers) draft.reviewerIDs.add(reviewer.reviewerID)
      for (const reviewerID of finding.reviewerIDs) draft.reviewerIDs.add(reviewerID)
      draft.attemptNumbers.add(attemptNumber)
      draft.symptomVariations.push(variation)
      draft.latestSeverity = finding.severity
      rootDrafts.set(rootKey, draft)
      if (!blockingRootLabels.includes(draft.canonicalLabel)) blockingRootLabels.push(draft.canonicalLabel)
    }
    latestAdvisoryFindings = advisoryFindings.map((finding) =>
      symptomVariation({
        finding,
        rootKey: rootGroupingKey(finding),
        canonicalLabel: canonicalRootLabel(finding),
        attemptNumber,
        artifactID: row.artifactID,
        reviewers,
      }),
    )

    attempts.push({
      attemptNumber,
      artifactID: row.artifactID,
      timeCreated: row.timeCreated,
      phase: phaseFrom(payload.phase),
      verdict: verdictFrom(payload.verdict),
      summary: stringFrom(payload.summary) ?? stringFrom(payload.reason),
      teamReportMarkdown: stringFrom(payload.team_report_markdown),
      reviewers,
      blockingFindings: blockingFindings.map(stripSeverity),
      requiredRepairs: requiredRepairSummaries(payload.required_repairs),
      unresolvedDisagreements: disagreementSummaries(payload.unresolved_disagreements),
      blockingRootLabels: blockingRootLabels.sort(),
    })
  })

  const persistentBlockingRoots = [...rootDrafts.values()]
    .map((draft): IntegrityPersistentRoot => {
      const attemptNumbers = [...draft.attemptNumbers].sort((left, right) => left - right)
      return {
        rootID: `root_${hashRootKey(draft.key)}`,
        canonicalLabel: draft.canonicalLabel,
        reviewerIDs: [...draft.reviewerIDs].sort(),
        firstSeenAttempt: attemptNumbers[0] ?? 0,
        latestSeenAttempt: attemptNumbers.at(-1) ?? 0,
        consecutiveAttempts: longestConsecutiveRun(attemptNumbers),
        symptomVariations: draft.symptomVariations,
        latestSeverity: draft.latestSeverity,
      }
    })
    .filter((root) => root.latestSeverity === "blocking" && root.consecutiveAttempts.length >= 3)
    .sort(
      (left, right) =>
        right.consecutiveAttempts.length - left.consecutiveAttempts.length ||
        right.latestSeenAttempt - left.latestSeenAttempt ||
        left.canonicalLabel.localeCompare(right.canonicalLabel),
    )

  const latestAttemptNumber = attempts.at(-1)?.attemptNumber
  const latestBlockingFindings = latestAttemptNumber
    ? [...rootDrafts.values()].flatMap((draft) =>
        draft.symptomVariations.filter((variation) => variation.attemptNumber === latestAttemptNumber),
      )
    : []

  return {
    taskID: input.taskID,
    specSnapshotLineage: input.specSnapshotLineage,
    totalAttempts: attempts.length,
    attempts,
    persistentBlockingRoots,
    latestBlockingFindings,
    latestAdvisoryFindings,
  }
}

function symptomVariation(input: {
  finding: FindingSummary
  rootKey: string
  canonicalLabel: string
  attemptNumber: number
  artifactID: string
  reviewers: Array<{ reviewerID: string; scope: string; verdict?: string }>
}): IntegrityRootSymptomVariation {
  const reviewerIDs = [
    ...new Set([
      ...input.finding.reviewerIDs,
      ...input.reviewers.map((reviewer) => reviewer.reviewerID).filter((reviewerID) => reviewerID.length > 0),
    ]),
  ].sort()
  return {
    attemptNumber: input.attemptNumber,
    artifactID: input.artifactID,
    findingID: input.finding.id,
    fingerprint: input.finding.fingerprint,
    rootID: `root_${hashRootKey(input.rootKey)}`,
    canonicalLabel: input.canonicalLabel,
    canonicalSymptom: input.finding.canonicalSymptom,
    severity: input.finding.severity,
    title: input.finding.title,
    description: input.finding.description,
    repair: input.finding.repair,
    verify: input.finding.verify,
    evidence: input.finding.evidence,
    reviewerIDs,
    filePaths: input.finding.filePaths,
    requirementIDs: input.finding.requirementIDs,
    specIDs: input.finding.specIDs,
  }
}

export function renderIntegrityRootHistoryBlock(history: IntegrityRootHistory): string {
  const lines: string[] = [
    "## Integrity (history) - rendered attempts on this spec snapshot lineage",
    "",
    `Lineage: active=${cleanInline(history.specSnapshotLineage.activeSpecSnapshotID)}; inherited=${
      history.specSnapshotLineage.inheritedSpecSnapshotIDs.length > 0
        ? history.specSnapshotLineage.inheritedSpecSnapshotIDs.map(cleanInline).join(", ")
        : "(none)"
    }; reason=${history.specSnapshotLineage.reason}`,
    `Total integrity rounds on this spec snapshot lineage: ${history.totalAttempts}`,
  ]

  if (history.totalAttempts === 0) {
    lines.push("", "No integrity attempts exist on this spec snapshot lineage.")
    return capSharedPromptText(lines.join("\n"))
  }

  lines.push(
    "",
    "Round N (most recent first):",
    "",
    "| R | delta from prev | Verdict | Reviewers | Blocking root labels | New since prev round |",
    "| - | --------------- | ------- | --------- | -------------------- | -------------------- |",
  )

  const attemptsByNumber = new Map(history.attempts.map((attempt) => [attempt.attemptNumber, attempt]))
  for (const attempt of history.attempts.slice().reverse()) {
    const previous = attemptsByNumber.get(attempt.attemptNumber - 1)
    const previousLabels = new Set(previous?.blockingRootLabels ?? [])
    const newLabels = attempt.blockingRootLabels.filter((label) => !previousLabels.has(label))
    const reviewerIDs = attempt.reviewers.map((reviewer) => reviewer.reviewerID).filter(Boolean)
    lines.push(
      `| R${attempt.attemptNumber} | ${previous ? durationFromMs(attempt.timeCreated - previous.timeCreated) : "-"} | ${
        attempt.verdict ?? "unknown"
      } | ${reviewerIDs.length > 0 ? reviewerIDs.map(cleanInline).join(", ") : "(none)"} | ${
        attempt.blockingRootLabels.length > 0
          ? attempt.blockingRootLabels.map((label) => `{${cleanInline(label)}}`).join(", ")
          : "(none)"
      } | ${
        previous
          ? newLabels.length > 0
            ? newLabels.map((label) => `{${cleanInline(label)}}`).join(", ")
            : "(none)"
          : "first round"
      } |`,
    )
  }

  lines.push("", "Persistent blocking roots (>= 3 consecutive attempts; fact assembly only):")
  if (history.persistentBlockingRoots.length === 0) {
    lines.push("- (none >= 3 consecutive)")
  } else {
    for (const root of history.persistentBlockingRoots) {
      lines.push(
        `- {${cleanInline(root.canonicalLabel)}}: ${root.consecutiveAttempts.map((attempt) => `R${attempt}`).join(" ")}.`,
      )
      lines.push(`  first seen: R${root.firstSeenAttempt}.`)
      lines.push(`  latest seen: R${root.latestSeenAttempt}.`)
      lines.push(
        `  reviewer ids: ${root.reviewerIDs.length > 0 ? root.reviewerIDs.map(cleanInline).join(", ") : "(none)"}.`,
      )
      const symptoms = root.symptomVariations
        .map((variation) => `R${variation.attemptNumber} ${cleanInline(variation.findingID)}`)
        .join("; ")
      lines.push(`  symptom variations: ${symptoms || "(none)"}.`)
    }
  }

  lines.push("", "Each round's full team_report_markdown is stored in engine_artifact kind=integrity_attempt.")
  return capSharedPromptText(lines.join("\n"))
}

export function persistentRootSummary(history: IntegrityRootHistory): string {
  if (history.persistentBlockingRoots.length === 0) return "persistent_roots=[]"
  const entries = history.persistentBlockingRoots.map(
    (root) => `${root.canonicalLabel}(${root.consecutiveAttempts.length})`,
  )
  return `persistent_roots=[${entries.join(",")}]`
}

function rootGroupingKey(finding: FindingSummary): string {
  const files = finding.filePaths.map(normalizePathForKey).filter(Boolean).sort()
  const symbol = symbolToken(`${finding.canonicalSymptom}\n${finding.title}\n${finding.description}\n${finding.repair}`)
  if (files.length > 0 && symbol) return `file-symbol:${files.join("|")}:${symbol}`
  const tokens = semanticTokens(
    `${finding.canonicalSymptom}\n${finding.title}\n${finding.description}\n${finding.repair}`,
  )
  if (files.length > 0) return `file-text:${files.join("|")}:${tokens.slice(0, 8).join("-")}`
  return `text:${tokens.slice(0, 10).join("-")}`
}

function canonicalRootLabel(finding: FindingSummary): string {
  const source = `${finding.canonicalSymptom} ${finding.title} ${finding.description} ${finding.repair}`
  const tokens = semanticTokens(source)
  const fileStem = finding.filePaths.map(fileStemToken).find(Boolean)
  const symbol = symbolToken(source)
  const selected = [...(symbol ? [symbol] : []), ...tokens, ...(fileStem ? [fileStem] : [])]
  const deduped = [...new Set(selected)].slice(0, 4)
  return deduped.length > 0 ? deduped.join("-") : `finding-${hashRootKey(finding.id).slice(0, 8)}`
}

function semanticTokens(text: string): string[] {
  const stop = new Set([
    "the",
    "and",
    "or",
    "with",
    "from",
    "into",
    "that",
    "this",
    "when",
    "where",
    "still",
    "must",
    "should",
    "needs",
    "need",
    "missing",
    "finding",
    "blocking",
    "round",
    "rounds",
    "again",
    "same",
    "does",
    "not",
    "has",
    "have",
    "is",
    "are",
    "in",
    "on",
    "for",
    "to",
    "of",
    "a",
    "an",
  ])
  return [
    ...new Set(
      text
        .toLowerCase()
        .match(/[a-z0-9]+/g)
        ?.map(stemToken)
        .filter((token) => token.length > 2 && !stop.has(token)) ?? [],
    ),
  ]
}

function stemToken(token: string): string {
  if (token.startsWith("validat")) return "validate"
  if (token.startsWith("persist")) return "persist"
  if (token.startsWith("setting")) return "settings"
  if (token.startsWith("storag")) return "storage"
  if (token.startsWith("require")) return "requirement"
  return token
}

function symbolToken(text: string): string | undefined {
  const match = text.match(/\b([A-Za-z_$][\w$]*)\s*\(/)
  return match ? stemToken(match[1]!.toLowerCase()) : undefined
}

function normalizePathForKey(filePath: string): string {
  return filePath.replace(/\\/g, "/").toLowerCase()
}

function fileStemToken(filePath: string): string | undefined {
  const leaf = normalizePathForKey(filePath).split("/").pop()
  const stem = leaf?.replace(/\.[^.]+$/, "")
  return stem ? stemToken(stem) : undefined
}

function longestConsecutiveRun(numbers: number[]): number[] {
  let best: number[] = []
  let current: number[] = []
  for (const number of numbers) {
    if (current.length === 0 || number === current[current.length - 1]! + 1) {
      current.push(number)
    } else {
      if (current.length > best.length) best = current
      current = [number]
    }
  }
  if (current.length > best.length) best = current
  return best
}

function durationFromMs(ms: number): string {
  const abs = Math.max(0, ms)
  const minutes = Math.round(abs / 60_000)
  if (minutes < 1) return "<1m"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest > 0 ? `${hours}h${rest}m` : `${hours}h`
}

function capSharedPromptText(text: string): string {
  const budget = getSharedIntegrityPromptBudget()
  if (text.length <= budget.totalCharCap) return text
  const marker = "\n[omitted_due_to_shared_prompt_cap]"
  return `${text.slice(0, Math.max(0, budget.totalCharCap - marker.length))}${marker}`
}

function cleanInline(value: string): string {
  return sanitizeIntegrityPromptText({
    text: value,
    field: "generic",
    markdownContext: "inline",
  })
    .text.replace(/\s+/g, " ")
    .trim()
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function phaseFrom(value: unknown): "pre_build" | "post_build" | undefined {
  return value === "pre_build" || value === "post_build" ? value : undefined
}

function verdictFrom(value: unknown): "pass" | "concerns" | "needs_correction" | undefined {
  return value === "pass" || value === "concerns" || value === "needs_correction" ? value : undefined
}

function reviewerSummaries(value: unknown): Array<{ reviewerID: string; scope: string; verdict?: string }> {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const reviewer = asRecord(item)
    const reviewerID = stringFrom(reviewer.reviewerID) ?? stringFrom(reviewer.id)
    const scope = stringFrom(reviewer.scope) ?? stringFrom(reviewer.focus) ?? stringFrom(reviewer.title)
    if (!reviewerID || !scope) return []
    return [{ reviewerID, scope, verdict: stringFrom(reviewer.verdict) }]
  })
}

function findingSummaries(value: unknown): FindingSummary[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const finding = asRecord(item)
    const severityRaw = stringFrom(finding.severity)
    const verdictImpact = stringFrom(finding.verdictImpact)
    const severity = severityRaw === "blocking" || verdictImpact === "needs_correction" ? "blocking" : "advisory"
    if (severity !== "blocking" && severityRaw !== "advisory") return []
    const normalizedSeverity: "blocking" | "advisory" = severity
    const draft = {
      id: stringFrom(finding.id) ?? "unknown-finding",
      title: stringFrom(finding.title) ?? "Untitled finding",
      description: stringFrom(finding.description) ?? "",
      repair: stringFrom(finding.repair) ?? "",
      evidence: stringArray(finding.evidence),
      filePaths: stringArray(finding.filePaths),
      requirementIDs: stringArray(finding.requirementIDs),
      specIDs: stringArray(finding.specIDs),
      severity: normalizedSeverity,
      reviewerIDs: stringArray(finding.reviewers),
    }
    const canonicalSymptom = stringFrom(finding.canonicalSymptom) ?? canonicalIntegritySymptom(draft)
    const withSymptom = { ...draft, canonicalSymptom }
    return [
      {
        ...withSymptom,
        fingerprint: stringFrom(finding.fingerprint) ?? integrityFindingFingerprint(withSymptom),
        verify:
          stringArray(finding.verify).length > 0 ? stringArray(finding.verify) : defaultIntegrityVerify(withSymptom),
      },
    ]
  })
}

function stripSeverity(finding: FindingSummary): IntegrityPriorAttemptSummary["blockingFindings"][number] {
  return {
    id: finding.id,
    fingerprint: finding.fingerprint,
    canonicalSymptom: finding.canonicalSymptom,
    title: finding.title,
    description: finding.description,
    repair: finding.repair,
    verify: finding.verify,
    filePaths: finding.filePaths,
    requirementIDs: finding.requirementIDs,
    specIDs: finding.specIDs,
  }
}

function requiredRepairSummaries(value: unknown): IntegrityPriorAttemptSummary["requiredRepairs"] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const repair = asRecord(item)
    const id = stringFrom(repair.id)
    const description = stringFrom(repair.description)
    if (!id || !description) return []
    const draft = {
      id,
      title: stringFrom(repair.title),
      description,
      repair: stringFrom(repair.repair) ?? description,
      filePaths: stringArray(repair.filePaths),
      requirementIDs: stringArray(repair.requirementIDs),
      specIDs: stringArray(repair.specIDs),
      sourceFindingIDs: stringArray(repair.sourceFindingIDs),
      priorAttemptRefs: stringArray(repair.priorAttemptRefs),
    }
    const canonicalSymptom = stringFrom(repair.canonicalSymptom) ?? canonicalIntegritySymptom(draft)
    const withSymptom = { ...draft, canonicalSymptom }
    return [
      {
        ...withSymptom,
        fingerprint: stringFrom(repair.fingerprint) ?? integrityFindingFingerprint(withSymptom),
        verify:
          stringArray(repair.verify).length > 0 ? stringArray(repair.verify) : defaultIntegrityVerify(withSymptom),
      },
    ]
  })
}

function disagreementSummaries(value: unknown): IntegrityPriorAttemptSummary["unresolvedDisagreements"] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const disagreement = asRecord(item)
    const id = stringFrom(disagreement.id)
    const description = stringFrom(disagreement.description)
    if (!id || !description) return []
    return [{ id, description }]
  })
}

function hashRootKey(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12)
}
