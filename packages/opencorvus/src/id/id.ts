import z from "zod"
import { randomBytes } from "crypto"

export namespace Identifier {
  const prefixes = {
    session: "ses",
    message: "msg",
    permission: "per",
    question: "que",
    user: "usr",
    part: "prt",
    pty: "pty",
    tool: "tool",
    workspace: "wrk",
    memory: "mem",
    memchunk: "mck",
    cron: "crn",
    task: "tsk",
    plan: "pln",
    goal: "gol",
    run: "run",
    interaction: "int",
    artifact: "art",
    attachment: "att",
    delivery: "dlv",
    delivery_round: "dlr",
    evaluation: "evl",
    binding: "bnd",
    progress: "prg",
    note: "nte",
    brief: "brf",
    milestone: "mst",
    executor_event: "exe",
    spec: "spc",
    specitem: "spi",
    goal_snapshot: "gls",
    goal_run: "glr",
    plan_node: "pln_node",
    requirement: "req",
    call: "cal",
    protocol_event: "pev",
    protocol_inbox: "pib",
    session_control: "sctl",
    worker_turn_descriptor: "wtd",
    goal_group: "glg",
    decision_log: "dlog",
    metric_spec: "mts",
    metric_result: "mtr",
    counterexample: "cex",
    /** LLM provider call lifecycle (one logical request, including its
     *  internal retries / heartbeats). See packages/opencorvus/src/llm/activity.ts. */
    activity: "act",
  } as const

  export function schema(prefix: keyof typeof prefixes) {
    return z.string().startsWith(prefixes[prefix])
  }

  const LENGTH = 26

  // State for monotonic ID generation
  let lastTimestamp = 0
  let counter = 0

  export function ascending(prefix: keyof typeof prefixes, given?: string) {
    return generateID(prefix, false, given)
  }

  export function descending(prefix: keyof typeof prefixes, given?: string) {
    return generateID(prefix, true, given)
  }

  function generateID(prefix: keyof typeof prefixes, descending: boolean, given?: string): string {
    if (!given) {
      return create(prefix, descending)
    }

    if (!given.startsWith(prefixes[prefix])) {
      throw new Error(`ID ${given} does not start with ${prefixes[prefix]}`)
    }
    return given
  }

  function randomBase62(length: number): string {
    const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    let result = ""
    const bytes = randomBytes(length)
    for (let i = 0; i < length; i++) {
      result += chars[bytes[i] % 62]
    }
    return result
  }

  export function create(prefix: keyof typeof prefixes, descending: boolean, timestamp?: number): string {
    const currentTimestamp = timestamp ?? Date.now()

    if (currentTimestamp !== lastTimestamp) {
      lastTimestamp = currentTimestamp
      counter = 0
    }
    counter++

    let now = BigInt(currentTimestamp) * BigInt(0x1000) + BigInt(counter)

    now = descending ? ~now : now

    const timeBytes = Buffer.alloc(6)
    for (let i = 0; i < 6; i++) {
      timeBytes[i] = Number((now >> BigInt(40 - 8 * i)) & BigInt(0xff))
    }

    return prefixes[prefix] + "_" + timeBytes.toString("hex") + randomBase62(LENGTH - 12)
  }

  export const SHORT_PATH_BODY_LENGTH = 12
  export const LEGACY_SHORT_PATH_BODY_LENGTH = 8

  /**
   * Returns prefix + '_' + the full timestamp/counter body for filesystem
   * path segments. The earlier 8-char form only kept the high timestamp
   * bytes, so goals created in one planning burst could map to the same
   * runtime directory and branch.
   */
  export function shortPath(fullID: string): string {
    const separator = fullID.lastIndexOf("_")
    if (separator <= 0) throw new Error(`Invalid ID for path segment: ${fullID}`)
    const prefix = fullID.slice(0, separator)
    const body = fullID.slice(separator + 1)
    if (!body) throw new Error(`Invalid ID body for path segment: ${fullID}`)
    return `${prefix}_${body.slice(0, SHORT_PATH_BODY_LENGTH)}`
  }

  export function legacyShortPath(fullID: string): string {
    const separator = fullID.lastIndexOf("_")
    if (separator <= 0) throw new Error(`Invalid ID for path segment: ${fullID}`)
    const prefix = fullID.slice(0, separator)
    const body = fullID.slice(separator + 1)
    if (!body) throw new Error(`Invalid ID body for path segment: ${fullID}`)
    return `${prefix}_${body.slice(0, LEGACY_SHORT_PATH_BODY_LENGTH)}`
  }

  /** Extract timestamp from an ascending ID. Does not work with descending IDs. */
  export function timestamp(id: string): number {
    const prefix = id.split("_")[0]
    const hex = id.slice(prefix.length + 1, prefix.length + 13)
    const encoded = BigInt("0x" + hex)
    return Number(encoded / BigInt(0x1000))
  }
}
