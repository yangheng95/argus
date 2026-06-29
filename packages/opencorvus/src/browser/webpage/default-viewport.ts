export const DEFAULT_WEBPAGE_EVIDENCE_VIEWPORT = {
  width: 1440,
  height: 1440,
} as const

export type WebpageEvidenceViewport = {
  width: number
  height: number
}

export function defaultWebpageEvidenceViewport(): WebpageEvidenceViewport {
  return { ...DEFAULT_WEBPAGE_EVIDENCE_VIEWPORT }
}

export function describeDefaultWebpageEvidenceViewport(): string {
  return `${DEFAULT_WEBPAGE_EVIDENCE_VIEWPORT.width}x${DEFAULT_WEBPAGE_EVIDENCE_VIEWPORT.height}`
}
