export interface DialogInteractionCandidate {
  id: string
  type?: string
  status?: string
  time?: {
    created?: number
  }
}

export function pickDialogInteraction<T extends DialogInteractionCandidate>(
  interactions: readonly T[] | null | undefined,
  dismissed: ReadonlySet<string>,
): T | null {
  if (!Array.isArray(interactions)) return null
  const pending = interactions.filter(
    (it) => it?.status === "pending" && (it.type === "permission" || it.type === "question"),
  )
  if (pending.length === 0) return null
  const sorted = [...pending].sort((a, b) => {
    const aT = Number(a.time?.created ?? 0)
    const bT = Number(b.time?.created ?? 0)
    return aT - bT
  })
  for (const it of sorted) {
    if (!dismissed.has(it.id)) return it
  }
  return null
}
