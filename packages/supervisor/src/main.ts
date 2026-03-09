import { parseArgs } from "node:util"
import { createOpencodeWorker } from "./opencode"
import { createSupervisor } from "./service"
import { createStore } from "./store"

const { positionals, values } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    title: { type: "string" },
    request: { type: "string" },
    acceptance: { type: "string" },
    goal: { type: "string" },
    label: { type: "string" },
    value: { type: "string" },
    scope: { type: "string" },
    "base-url": { type: "string" },
    directory: { type: "string" },
    "max-rounds": { type: "string" },
  },
})

const cwd = values.directory ?? process.cwd()
const store = createStore(cwd)
const worker = createOpencodeWorker({
  baseUrl: values["base-url"],
  directory: cwd,
})
const supervisor = createSupervisor({ store, worker })
const command = positionals[0]

if (!command) {
  throw new Error("Missing command. Use create, status, run, or prefer.")
}

if (command === "create") {
  const result = await supervisor.createGoal({
    title: need(values.title, "title"),
    request: need(values.request, "request"),
    acceptance: need(values.acceptance, "acceptance"),
    maxRounds: count(values["max-rounds"]),
  })
  console.log(JSON.stringify(result, null, 2))
}

if (command === "status") {
  const result = await supervisor.status(values.goal)
  console.log(JSON.stringify(result, null, 2))
}

if (command === "run") {
  const result = await supervisor.runGoal(need(values.goal, "goal"))
  console.log(JSON.stringify(result, null, 2))
}

if (command === "prefer") {
  const result = await supervisor.addPreference({
    label: need(values.label, "label"),
    value: need(values.value, "value"),
    scope: scope(values.scope),
  })
  console.log(JSON.stringify(result, null, 2))
}

function need(input: string | boolean | undefined, key: string) {
  if (typeof input === "string" && input.trim()) return input.trim()
  throw new Error(`Missing --${key}`)
}

function count(input: string | boolean | undefined) {
  if (typeof input !== "string" || !input.trim()) return undefined
  const value = Number.parseInt(input, 10)
  if (!Number.isFinite(value) || value < 1) throw new Error("max-rounds must be a positive integer")
  return value
}

function scope(input: string | boolean | undefined) {
  if (input === "user" || input === "project") return input
  if (input === undefined) return undefined
  throw new Error("scope must be project or user")
}
