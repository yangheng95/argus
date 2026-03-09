import { ulid } from "ulid"
import { parseVerify, prompt, repair, seed } from "./planner"
import { type Preference, Goal as GoalSchema, now, Preference as PreferenceSchema, Run as RunSchema } from "./schema"
import type { createStore } from "./store"
import type { Worker } from "./worker"

export function createSupervisor(input: { store: ReturnType<typeof createStore>; worker: Worker }) {
  const { store, worker } = input

  async function createGoal(payload: {
    title: string
    request: string
    acceptance: string
    maxRounds?: number
  }) {
    const time = now()
    const goal = GoalSchema.parse({
      id: ulid(),
      title: payload.title,
      request: payload.request,
      acceptance: payload.acceptance,
      status: "active",
      round: 0,
      maxRounds: payload.maxRounds ?? 3,
      createdAt: time,
      updatedAt: time,
    })
    await store.insertGoal(goal)
    await store.insertPhases(seed(goal.id))
    return store.detail(goal.id)
  }

  async function addPreference(payload: {
    label: string
    value: string
    scope?: Preference["scope"]
  }) {
    const preference = PreferenceSchema.parse({
      id: ulid(),
      label: payload.label,
      value: payload.value,
      scope: payload.scope ?? "project",
      createdAt: now(),
    })
    return store.insertPreference(preference)
  }

  async function status(goalId?: string) {
    if (!goalId) return store.load()
    return store.detail(goalId)
  }

  async function runGoal(goalId: string) {
    let view = await must(goalId)
    let goal = view.goal
    if (goal.status === "completed") return view

    const preferences = view.preferences

    while (true) {
      view = await must(goalId)
      goal = view.goal

      const phase = view.phases.find((item) => item.status === "pending")
      if (!phase) return view

      await store.updatePhase(phase.id, { status: "in_progress" })

      const run = RunSchema.parse({
        id: ulid(),
        goalId: goal.id,
        phaseId: phase.id,
        sessionId: goal.sessionId ?? "pending",
        agent: phase.agent,
        status: "running",
        createdAt: now(),
        updatedAt: now(),
      })
      await store.insertRun(run)

      const result = await worker.run({
        title: goal.title,
        agent: phase.agent,
        prompt: prompt(goal, phase, preferences),
        sessionId: goal.sessionId,
      })

      await store.updateGoal(goal.id, { sessionId: result.sessionId })
      await store.updateRun(run.id, {
        sessionId: result.sessionId,
        messageId: result.messageId,
        status: "completed",
        output: result.text,
        summary: result.text.slice(0, 400),
      })
      await store.updatePhase(phase.id, { status: "completed" })

      if (phase.kind !== "verify") continue

      const verify = parseVerify(result.text)
      if (verify.done) {
        await store.updateGoal(goal.id, {
          status: "completed",
          lastGap: undefined,
        })
        return must(goal.id)
      }

      const nextRound = goal.round + 1
      if (nextRound > goal.maxRounds) {
        await store.updateGoal(goal.id, {
          status: "blocked",
          lastGap: verify.summary,
          round: nextRound,
        })
        return must(goal.id)
      }

      const position = view.phases.length
      await store.insertPhases(repair(goal.id, position, verify.nextStep))
      await store.updateGoal(goal.id, {
        round: nextRound,
        lastGap: verify.summary,
        status: "active",
      })
    }
  }

  async function must(goalId: string) {
    const view = await store.detail(goalId)
    const goal = view.goal
    if (!goal) throw new Error(`Goal not found: ${goalId}`)
    return {
      ...view,
      goal,
    }
  }

  return {
    createGoal,
    addPreference,
    status,
    runGoal,
  }
}
