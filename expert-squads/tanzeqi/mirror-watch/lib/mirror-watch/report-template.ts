// HTML means HyperText Markup Language. JSON means JavaScript Object Notation.

import reportTemplate from "../../assets/report.template.html" with { type: "text" }

export interface MirrorWatchReportData {
  schema_version: 1
  meta: {
    title: string
    subtitle: string
    n: number
    badges: Array<{ label: string; value: string }>
  }
  featNames: Record<string, string>
  stats: {
    score: Record<string, number>
    first: Record<string, number>
    second: Record<string, number>
    third: Record<string, number>
    mention: Record<string, number>
  }
  byTier: MirrorWatchSegment
  byStatus: MirrorWatchSegment
  byMode: MirrorWatchSegment
  byFreq: MirrorWatchSegment
  bundles: Array<[string, number]>
  bundlesNote: string
  quotes: Array<{
    user: string
    tier: string
    status: string
    statusClass: string
    mode: string
    pick: string
    text: string
  }>
  tldr: string[]
  kpis: Array<{ label: string; code: string; name: string; score: number; color: string }>
  insights: Array<{ n: number; text: string; evidence: string }>
  recommendations: Array<{
    priority: string
    badge: string
    title: string
    why: string
    how: string
  }>
  qualitativeExperts: Array<{
    name: string
    perspective: string
    picks: string[]
    confidence: string
    reason: string
  }>
  footnote: string[]
}

export interface MirrorWatchSegment {
  order: string[]
  counts: Record<string, number>
  data: Record<string, Record<string, number>>
  top1: Record<string, { code: string; score: number } | null>
  top3: Record<string, Array<{ code: string; score: number }>>
  note?: string
}

function jsonForScript(value: unknown) {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029")
}

function htmlText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

export function renderMirrorWatchReport(report: MirrorWatchReportData) {
  const dataPlaceholder = "/*__REPORT_DATA__*/ null"
  const dataOccurrences = reportTemplate.split(dataPlaceholder).length - 1
  if (dataOccurrences !== 1) throw new Error("Mirror Watch report template must contain exactly one data placeholder")
  return reportTemplate.replaceAll("__TITLE__", htmlText(report.meta.title)).replace(dataPlaceholder, jsonForScript(report))
}
