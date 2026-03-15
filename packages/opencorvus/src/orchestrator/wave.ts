import z from "zod"

export const WaveContract = z.object({
  title: z.string(),
  objective: z.string().optional(),
  goal_indices: z.array(z.number()),
  owned_paths: z.array(z.string()).optional(),
  produces: z.array(z.string()).optional(),
  consumes: z.array(z.string()).optional(),
  parallelism: z.number().int().positive().optional(),
})

export type WaveContractType = z.infer<typeof WaveContract>

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function cleanList(value: unknown) {
  const seen = new Set<string>()
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const text = cleanText(item)
        if (!text || seen.has(text)) return []
        seen.add(text)
        return [text]
      })
    : []
}

function cleanIndex(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined
}

function indexCoverage(waves: Array<Record<string, unknown>>, goalCount: number, offset: 0 | -1) {
  const covered = new Set<number>()
  let zeroSeen = false
  for (const wave of waves) {
    const indices = Array.isArray(wave.goal_indices) ? wave.goal_indices : []
    for (const raw of indices) {
      const value = cleanIndex(raw)
      if (value === 0) zeroSeen = true
      const next = value === undefined ? undefined : value + offset
      if (next === undefined || next < 0 || next >= goalCount) continue
      covered.add(next)
    }
  }
  return {
    covered: covered.size,
    zeroSeen,
  }
}

function preferOneBased(waves: Array<Record<string, unknown>>, goalCount: number) {
  const zeroBased = indexCoverage(waves, goalCount, 0)
  const oneBased = indexCoverage(waves, goalCount, -1)
  if (oneBased.covered > zeroBased.covered) return true
  if (zeroBased.covered > oneBased.covered) return false
  return !zeroBased.zeroSeen && oneBased.covered > 0
}

function defaultWaveTitle(index: number, goal: { description?: string } | undefined) {
  const description = cleanText(goal?.description)
  if (!description) return `Wave ${index + 1}`
  return `Wave ${index + 1}: ${description}`
}

export function normalizePlanWaves(input: {
  waves?: unknown
  goals: Array<{ description: string }>
}) {
  const raw = Array.isArray(input.waves)
    ? input.waves.flatMap((item) => item && typeof item === "object" && !Array.isArray(item) ? [item as Record<string, unknown>] : [])
    : []
  const goalCount = input.goals.length
  const shift = preferOneBased(raw, goalCount) ? -1 : 0
  const claimed = new Set<number>()
  const waves: WaveContractType[] = raw.flatMap((item, index) => {
    const goal_indices = [...new Set((Array.isArray(item.goal_indices) ? item.goal_indices : [])
      .flatMap((value) => {
        const next = cleanIndex(value)
        if (next === undefined) return []
        const mapped = next + shift
        if (mapped < 0 || mapped >= goalCount || claimed.has(mapped)) return []
        return [mapped]
      }))]
    if (goal_indices.length === 0) return []
    for (const goalIndex of goal_indices) claimed.add(goalIndex)
    return [WaveContract.parse({
      title: cleanText(item.title) || defaultWaveTitle(index, input.goals[goal_indices[0]]),
      objective: cleanText(item.objective) || cleanText(item.description) || undefined,
      goal_indices,
      owned_paths: cleanList(item.owned_paths),
      produces: cleanList(item.produces),
      consumes: cleanList(item.consumes),
      parallelism: cleanIndex(item.parallelism),
    })]
  })
  let fallbackOffset = 0
  const fallback = input.goals.flatMap((goal, goalIndex) => {
    if (claimed.has(goalIndex)) return []
    const waveDisplayIndex = waves.length + fallbackOffset++
    return [WaveContract.parse({
      title: defaultWaveTitle(waveDisplayIndex, goal),
      objective: cleanText(goal.description) || undefined,
      goal_indices: [goalIndex],
      owned_paths: [],
      produces: [],
      consumes: [],
      parallelism: 1,
    })]
  })
  return [...waves, ...fallback]
}

export function waveMilestones(waves: WaveContractType[]) {
  return waves.map((wave) => ({
    title: wave.title,
    description: wave.objective,
    goal_indices: wave.goal_indices,
  }))
}
