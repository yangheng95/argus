const idle = new AbortController().signal

function wait(ms: number, abort: AbortSignal) {
  if (ms <= 0) return Promise.resolve()
  if (abort.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer)
      abort.removeEventListener("abort", done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    abort.addEventListener("abort", done, { once: true })
  })
}

export namespace Automation {
  export type ErrorKind = "not_found" | "not_interactable" | "state_mismatch" | "infra" | "timeout" | "aborted"

  export type Stage = "locate" | "pre" | "act" | "post" | "recover" | "snapshot"

  export type Locator =
    | { kind: "aid"; value: string; weight?: number }
    | { kind: "role"; value: string; name?: string; weight?: number }
    | { kind: "text"; value: string; exact?: boolean; weight?: number }
    | { kind: "image"; value: string; threshold?: number; weight?: number }

  export type Check =
    | { kind: "exists" }
    | { kind: "visible" }
    | { kind: "enabled" }
    | { kind: "focused" }
    | { kind: "stable" }
    | { kind: "state"; key: string; value: string | number | boolean }

  export type Action =
    | { kind: "click"; button?: "left" | "right" | "middle" | "double" }
    | { kind: "type"; text: string }
    | { kind: "hotkey"; keys: string[] }
    | { kind: "scroll"; direction: "up" | "down"; amount?: number }
    | { kind: "wait"; ms: number }
    | { kind: "custom"; name: string; data?: Record<string, unknown> }

  export interface Retry {
    max?: number
    backoffMs?: number[]
  }

  export interface Step {
    id: string
    target?: Locator[]
    pre?: Check[]
    act: Action
    post?: Check[]
    recoverOn?: ErrorKind[]
    timeoutMs?: number
    intervalMs?: number
    retry?: Retry
  }

  export interface Node {
    id: string
    attrs?: Record<string, unknown>
  }

  export interface Snapshot {
    id: string
    at?: number
    note?: string
  }

  export interface Probe<T = undefined> {
    ok: boolean
    data?: T
    kind?: ErrorKind
    detail?: string
  }

  export interface Trace {
    stepId: string
    attempt: number
    stage: Stage
    ok: boolean
    at: number
    elapsedMs?: number
    check?: Check["kind"]
    kind?: ErrorKind
    detail?: string
    shot?: string
  }

  export interface StepResult {
    id: string
    ok: boolean
    tries: number
    kind?: ErrorKind
    detail?: string
    trace: Trace[]
  }

  export interface FlowResult {
    ok: boolean
    steps: StepResult[]
  }

  export interface Opt {
    timeoutMs: number
    intervalMs: number
    retryMax: number
    backoffMs: number[]
  }

  export interface Driver {
    locate(input: { step: Step; target: Locator[]; abort: AbortSignal }): Promise<Probe<Node>>
    check(input: {
      step: Step
      check: Check
      node: Node | null
      stage: "pre" | "post"
      abort: AbortSignal
    }): Promise<Probe>
    act(input: { step: Step; act: Action; node: Node | null; abort: AbortSignal }): Promise<Probe>
    recover?(input: {
      step: Step
      attempt: number
      node: Node | null
      kind: ErrorKind
      detail?: string
      abort: AbortSignal
    }): Promise<Probe>
    snapshot?(input: { step: Step; attempt: number; label: string; abort: AbortSignal }): Promise<Snapshot | null>
  }

  export interface Engine {
    opts: Opt
    run(step: Step, input?: { abort?: AbortSignal }): Promise<StepResult>
    runAll(steps: Step[], input?: { abort?: AbortSignal; stopOnFail?: boolean }): Promise<FlowResult>
  }

  function merge(base: Opt, step: Step): Opt {
    return {
      timeoutMs: step.timeoutMs ?? base.timeoutMs,
      intervalMs: step.intervalMs ?? base.intervalMs,
      retryMax: step.retry?.max ?? base.retryMax,
      backoffMs: step.retry?.backoffMs ?? base.backoffMs,
    }
  }

  function fallback(stage: Stage): ErrorKind {
    if (stage === "locate") return "not_found"
    if (stage === "act") return "not_interactable"
    if (stage === "pre" || stage === "post") return "state_mismatch"
    return "infra"
  }

  function recoverable(step: Step, kind: ErrorKind) {
    if (!step.recoverOn || step.recoverOn.length === 0) {
      return kind === "not_interactable" || kind === "state_mismatch" || kind === "infra"
    }
    return step.recoverOn.includes(kind)
  }

  async function poll<T>(
    fn: () => Promise<Probe<T>>,
    opts: Opt,
    abort: AbortSignal,
  ): Promise<Probe<T> & { elapsedMs: number }> {
    const start = Date.now()
    let last: Probe<T> = { ok: false, kind: "timeout", detail: "timeout" }
    while (Date.now() - start <= opts.timeoutMs) {
      if (abort.aborted) {
        return {
          ok: false,
          kind: "aborted",
          detail: "aborted",
          elapsedMs: Date.now() - start,
        }
      }
      const next = await fn()
      if (next.ok) {
        return {
          ...next,
          elapsedMs: Date.now() - start,
        }
      }
      last = next
      if (Date.now() - start >= opts.timeoutMs) break
      await wait(opts.intervalMs, abort)
    }
    return {
      ok: false,
      kind: last.kind ?? "timeout",
      detail: last.detail ?? "timeout",
      elapsedMs: Date.now() - start,
    }
  }

  function push(
    trace: Trace[],
    stepId: string,
    attempt: number,
    stage: Stage,
    probe: Probe<unknown>,
    extra?: { elapsedMs?: number; check?: Check["kind"]; shot?: string },
  ) {
    trace.push({
      stepId,
      attempt,
      stage,
      ok: probe.ok,
      at: Date.now(),
      elapsedMs: extra?.elapsedMs,
      check: extra?.check,
      kind: probe.kind,
      detail: probe.detail,
      shot: extra?.shot,
    })
  }

  async function fail(input: {
    step: Step
    attempt: number
    max: number
    conf: Opt
    trace: Trace[]
    probe: Probe
    stage: Stage
    node: Node | null
    driver: Driver
    abort: AbortSignal
  }): Promise<StepResult | null> {
    const kind = input.probe.kind ?? fallback(input.stage)
    const detail = input.probe.detail

    if (input.driver.recover && recoverable(input.step, kind)) {
      const recovered = await input.driver.recover({
        step: input.step,
        attempt: input.attempt,
        node: input.node,
        kind,
        detail,
        abort: input.abort,
      })
      push(input.trace, input.step.id, input.attempt, "recover", recovered)
    }

    if (input.driver.snapshot) {
      const shot = await input.driver.snapshot({
        step: input.step,
        attempt: input.attempt,
        label: "fail",
        abort: input.abort,
      })
      if (shot) {
        push(input.trace, input.step.id, input.attempt, "snapshot", { ok: true }, { shot: shot.id, elapsedMs: 0 })
      }
    }

    if (input.abort.aborted || kind === "aborted") {
      return {
        id: input.step.id,
        ok: false,
        tries: input.attempt,
        kind: "aborted",
        detail: detail ?? "aborted",
        trace: input.trace,
      }
    }

    if (input.attempt >= input.max) {
      return {
        id: input.step.id,
        ok: false,
        tries: input.attempt,
        kind,
        detail: detail ?? "failed",
        trace: input.trace,
      }
    }

    const i = Math.min(input.attempt - 1, input.conf.backoffMs.length - 1)
    const ms = i >= 0 ? (input.conf.backoffMs[i] ?? 0) : 0
    await wait(ms, input.abort)
    return null
  }

  export function create(driver: Driver, input: Partial<Opt> = {}): Engine {
    const opts: Opt = {
      timeoutMs: input.timeoutMs ?? 5000,
      intervalMs: input.intervalMs ?? 120,
      retryMax: input.retryMax ?? 2,
      backoffMs: input.backoffMs ?? [120, 320, 640],
    }

    async function run(step: Step, input: { abort?: AbortSignal } = {}): Promise<StepResult> {
      const abort = input.abort ?? idle
      const conf = merge(opts, step)
      const max = Math.max(1, conf.retryMax)
      const trace: Trace[] = []

      for (let attempt = 1; attempt <= max; attempt++) {
        let node: Node | null = null

        if (step.target && step.target.length > 0) {
          const hit = await poll(() => driver.locate({ step, target: step.target!, abort }), conf, abort)
          const probe =
            !hit.ok || !hit.data
              ? {
                  ok: false,
                  kind: hit.kind ?? "not_found",
                  detail: hit.detail ?? "target not found",
                }
              : hit
          push(trace, step.id, attempt, "locate", probe, { elapsedMs: hit.elapsedMs })
          if (!probe.ok) {
            const result = await fail({
              step,
              attempt,
              max,
              conf,
              trace,
              probe: {
                ok: false,
                kind: probe.kind ?? "not_found",
                detail: probe.detail ?? "target not found",
              },
              stage: "locate",
              node,
              driver,
              abort,
            })
            if (result) return result
            continue
          }
          node = hit.data ?? null
        }

        const pre = step.pre ?? []
        let blocked = false
        for (const check of pre) {
          const hit = await poll(() => driver.check({ step, check, node, stage: "pre", abort }), conf, abort)
          push(trace, step.id, attempt, "pre", hit, {
            elapsedMs: hit.elapsedMs,
            check: check.kind,
          })
          if (hit.ok) continue
          const result = await fail({
            step,
            attempt,
            max,
            conf,
            trace,
            probe: {
              ok: false,
              kind: hit.kind ?? "state_mismatch",
              detail: hit.detail ?? "pre check failed",
            },
            stage: "pre",
            node,
            driver,
            abort,
          })
          if (result) return result
          blocked = true
          break
        }
        if (blocked) continue

        const acted = await driver.act({ step, act: step.act, node, abort })
        const actProbe = acted.ok
          ? acted
          : {
              ok: false,
              kind: acted.kind ?? "not_interactable",
              detail: acted.detail ?? "action failed",
            }
        push(trace, step.id, attempt, "act", actProbe)
        if (!actProbe.ok) {
          const result = await fail({
            step,
            attempt,
            max,
            conf,
            trace,
            probe: {
              ok: false,
              kind: actProbe.kind ?? "not_interactable",
              detail: actProbe.detail ?? "action failed",
            },
            stage: "act",
            node,
            driver,
            abort,
          })
          if (result) return result
          continue
        }

        const post = step.post ?? []
        let unstable = false
        for (const check of post) {
          const hit = await poll(() => driver.check({ step, check, node, stage: "post", abort }), conf, abort)
          push(trace, step.id, attempt, "post", hit, {
            elapsedMs: hit.elapsedMs,
            check: check.kind,
          })
          if (hit.ok) continue
          const result = await fail({
            step,
            attempt,
            max,
            conf,
            trace,
            probe: {
              ok: false,
              kind: hit.kind ?? "state_mismatch",
              detail: hit.detail ?? "post check failed",
            },
            stage: "post",
            node,
            driver,
            abort,
          })
          if (result) return result
          unstable = true
          break
        }
        if (unstable) continue

        if (driver.snapshot) {
          const shot = await driver.snapshot({
            step,
            attempt,
            label: "ok",
            abort,
          })
          if (shot) {
            push(
              trace,
              step.id,
              attempt,
              "snapshot",
              { ok: true },
              {
                shot: shot.id,
                elapsedMs: 0,
              },
            )
          }
        }

        return {
          id: step.id,
          ok: true,
          tries: attempt,
          trace,
        }
      }

      return {
        id: step.id,
        ok: false,
        tries: max,
        kind: "infra",
        detail: "unexpected end",
        trace,
      }
    }

    async function runAll(
      steps: Step[],
      input: { abort?: AbortSignal; stopOnFail?: boolean } = {},
    ): Promise<FlowResult> {
      const list: StepResult[] = []
      const stop = input.stopOnFail ?? true
      for (const step of steps) {
        const result = await run(step, { abort: input.abort })
        list.push(result)
        if (result.ok) continue
        if (stop) return { ok: false, steps: list }
      }
      return {
        ok: list.every((x) => x.ok),
        steps: list,
      }
    }

    return {
      opts,
      run,
      runAll,
    }
  }
}
