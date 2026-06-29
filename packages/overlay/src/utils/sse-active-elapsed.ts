export interface SseActiveElapsedState {
  /** Elapsed ms (milliseconds) accumulated between selected-task SSE updates while the task is active. */
  elapsedMs: number
  key: string
  observedAt?: number
}

export interface SseActiveElapsedInput {
  active: boolean
  eventAt: number
  key: string
}

export function advanceSseActiveElapsed(
  state: SseActiveElapsedState,
  input: SseActiveElapsedInput,
): SseActiveElapsedState {
  if (!Number.isFinite(input.eventAt)) {
    throw new Error(`SSE active elapsed timestamp must be finite, got ${input.eventAt}`)
  }
  if (!input.key) return { key: "", elapsedMs: 0 }

  const elapsedMs = state.key === input.key ? state.elapsedMs : 0
  if (!input.active) return { key: input.key, elapsedMs }
  if (state.key !== input.key || state.observedAt === undefined) {
    return { key: input.key, elapsedMs, observedAt: input.eventAt }
  }
  if (input.eventAt < state.observedAt) {
    throw new Error(`SSE active elapsed timestamp moved backwards for ${input.key}`)
  }
  return {
    key: input.key,
    elapsedMs: elapsedMs + input.eventAt - state.observedAt,
    observedAt: input.eventAt,
  }
}

export function pauseSseActiveElapsed(state: SseActiveElapsedState, key: string): SseActiveElapsedState {
  if (!key) return { key: "", elapsedMs: 0 }
  if (state.key !== key) return { key, elapsedMs: 0 }
  return { key, elapsedMs: state.elapsedMs }
}
