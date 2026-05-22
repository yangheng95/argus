const MODEL_REFERENCE_RE = /^[^/\s]+\/[^/\s]+$/

export function isModelReference(value: string): boolean {
  return MODEL_REFERENCE_RE.test(value)
}
