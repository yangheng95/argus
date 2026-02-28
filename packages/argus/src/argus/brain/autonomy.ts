import type { AutonomyLevel } from "../monitor/types"

const SAFE_TOOLS = new Set([
  "screen",
  "read",
  "glob",
  "grep",
  "list",
  "websearch",
  "webfetch",
  "codesearch",
])

const RISKY_TOOLS = new Set([
  "input",
  "bash",
  "edit",
  "write",
])

export namespace Autonomy {
  export function classifyRisk(tool: string): "safe" | "risky" | "dangerous" {
    if (SAFE_TOOLS.has(tool)) return "safe"
    if (RISKY_TOOLS.has(tool)) return "risky"
    return "dangerous"
  }

  export function shouldAutoExecute(
    level: AutonomyLevel,
    tools: string[],
  ): { allowed: boolean; reason: string } {
    if (tools.length === 0) {
      return { allowed: true, reason: "no tools requested" }
    }

    const risks = tools.map((t) => ({ tool: t, risk: classifyRisk(t) }))
    const maxRisk = risks.some((r) => r.risk === "dangerous")
      ? "dangerous"
      : risks.some((r) => r.risk === "risky")
        ? "risky"
        : "safe"

    switch (level) {
      case 0:
        // Observe only — deny all tool execution
        return {
          allowed: false,
          reason: "autonomy level 0: observation only, no tool execution allowed",
        }

      case 1:
        // Suggest only — deny all, will downgrade to suggestion
        return {
          allowed: false,
          reason: "autonomy level 1: can only suggest actions, not execute",
        }

      case 2:
        // Semi-auto — safe tools auto-execute, risky/dangerous need confirmation
        if (maxRisk === "safe") {
          return { allowed: true, reason: "autonomy level 2: safe tools auto-execute" }
        }
        return {
          allowed: false,
          reason: `autonomy level 2: ${maxRisk} tools require user confirmation`,
        }

      case 3:
        // Full auto — everything allowed
        return { allowed: true, reason: "autonomy level 3: full auto-execution" }

      default:
        return { allowed: false, reason: `unknown autonomy level: ${level}` }
    }
  }

  export function describeLevel(level: AutonomyLevel): string {
    switch (level) {
      case 0:
        return "Observe: record and notify only"
      case 1:
        return "Suggest: describe and recommend actions"
      case 2:
        return "Semi-auto: auto-execute safe tools, confirm risky ones"
      case 3:
        return "Full-auto: execute all actions automatically"
    }
  }
}
