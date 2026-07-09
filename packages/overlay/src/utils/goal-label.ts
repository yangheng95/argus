export function goalRevisionLabel(order: unknown, revision: unknown): string {
  const rawOrder = Number(order)
  const rawRevision = Number(revision)
  const safeOrder = Number.isFinite(rawOrder) ? Math.max(0, Math.trunc(rawOrder)) : 0
  const safeRevision = Number.isFinite(rawRevision) ? Math.max(1, Math.trunc(rawRevision)) : 1
  return safeOrder > 0 ? `#G${safeOrder}V${safeRevision}` : `V${safeRevision}`
}

export function goalRevisionLabelFromIndexes(orderIndex: unknown, retryCount: unknown): string {
  const order = Number.isFinite(Number(orderIndex)) ? Number(orderIndex) + 1 : 0
  const revision = Number.isFinite(Number(retryCount)) ? Number(retryCount) + 1 : 1
  return goalRevisionLabel(order, revision)
}

export function goalCompactLabel(order: unknown, revision: unknown): string {
  const rawOrder = Number(order)
  const rawRevision = Number(revision)
  const safeOrder = Number.isFinite(rawOrder) ? Math.max(0, Math.trunc(rawOrder)) : 0
  const safeRevision = Number.isFinite(rawRevision) ? Math.max(1, Math.trunc(rawRevision)) : 1
  if (safeOrder <= 0) return `V${safeRevision}`
  return safeRevision > 1 ? `#G${safeOrder}·${safeRevision}` : `#G${safeOrder}`
}

export function goalCompactLabelFromIndexes(orderIndex: unknown, retryCount: unknown): string {
  const order = Number.isFinite(Number(orderIndex)) ? Number(orderIndex) + 1 : 0
  const revision = Number.isFinite(Number(retryCount)) ? Number(retryCount) + 1 : 1
  return goalCompactLabel(order, revision)
}
