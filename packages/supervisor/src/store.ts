import { mkdir } from "node:fs/promises"
import path from "node:path"
import {
  Goal as GoalSchema,
  type Goal,
  Phase as PhaseSchema,
  type Phase,
  type Preference,
  Run as RunSchema,
  type Run,
  State,
  now,
} from "./schema"

export function createStore(root: string) {
  const file = path.join(root, ".opencorvus", "supervisor", "state.json")

  async function load() {
    const target = Bun.file(file)
    if (!(await target.exists())) return State.parse({})
    return State.parse(await target.json())
  }

  async function save(state: ReturnType<typeof State.parse>) {
    await mkdir(path.dirname(file), { recursive: true })
    await Bun.write(file, `${JSON.stringify(state, null, 2)}\n`)
    return state
  }

  async function detail(goalId: string) {
    const state = await load()
    return {
      goal: state.goals.find((item) => item.id === goalId) ?? null,
      phases: state.phases.filter((item) => item.goalId === goalId).sort((a, b) => a.position - b.position),
      runs: state.runs.filter((item) => item.goalId === goalId),
      preferences: state.preferences,
    }
  }

  async function insertGoal(goal: Goal) {
    const state = await load()
    state.goals.push(goal)
    return save(state)
  }

  async function insertPhases(phases: Phase[]) {
    const state = await load()
    state.phases.push(...phases)
    return save(state)
  }

  async function insertRun(run: Run) {
    const state = await load()
    state.runs.push(run)
    await save(state)
    return run
  }

  async function insertPreference(preference: Preference) {
    const state = await load()
    state.preferences.push(preference)
    await save(state)
    return preference
  }

  async function updateGoal(goalId: string, patch: Partial<Goal>) {
    const state = await load()
    state.goals = state.goals.map((item) =>
      item.id === goalId
        ? GoalSchema.parse({
            ...item,
            ...patch,
            updatedAt: now(),
          })
        : item,
    )
    await save(state)
    return state.goals.find((item) => item.id === goalId) ?? null
  }

  async function updatePhase(phaseId: string, patch: Partial<Phase>) {
    const state = await load()
    state.phases = state.phases.map((item) =>
      item.id === phaseId
        ? PhaseSchema.parse({
            ...item,
            ...patch,
            updatedAt: now(),
          })
        : item,
    )
    await save(state)
    return state.phases.find((item) => item.id === phaseId) ?? null
  }

  async function updateRun(runId: string, patch: Partial<Run>) {
    const state = await load()
    state.runs = state.runs.map((item) =>
      item.id === runId
        ? RunSchema.parse({
            ...item,
            ...patch,
            updatedAt: now(),
          })
        : item,
    )
    await save(state)
    return state.runs.find((item) => item.id === runId) ?? null
  }

  async function listPreferences() {
    return load().then((state) => state.preferences)
  }

  return {
    file,
    load,
    save,
    detail,
    insertGoal,
    insertPhases,
    insertRun,
    insertPreference,
    updateGoal,
    updatePhase,
    updateRun,
    listPreferences,
  }
}
