import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { CardNode } from "../src/store/card-tree"
import {
  buildPhaseChildForStep,
  defaultExpandedForNode,
  stepHeaderNodeWithBuildPhase,
  visibleChildIDsForCard,
} from "../src/utils/card-tree"

function card(partial: Partial<CardNode> & Pick<CardNode, "id" | "kind" | "title">): CardNode {
  return {
    parts: [],
    childIDs: [],
    time: 1,
    ...partial,
  } as CardNode
}

describe("build phase promotion render policy", () => {
  test("expanded build steps hydrate historical build sessions directly", () => {
    const source = readFileSync(join(import.meta.dir, "../src/components/Card.tsx"), "utf8")
    expect(source).toContain('import { loadConversationSessionHistory } from "../services/conversation"')
    expect(source).toContain("props.node.stepPayload?.buildSessionID")
    expect(source).toContain('const directory = String(boardStore.board?.task?.directory || "").trim()')
    expect(source).toContain("loadConversationSessionHistory(sessionID, taskID, { directory })")
  })

  test("filters the build phase from visible step children", () => {
    const step = card({
      id: "step:g1:build",
      kind: "step",
      title: "Goal",
      childIDs: ["step:g1:build:phase:build", "step:g1:build:phase:plan"],
    })
    const build = card({
      id: "step:g1:build:phase:build",
      kind: "phase",
      phaseID: "build",
      title: "Build",
    })
    const plan = card({
      id: "step:g1:build:phase:plan",
      kind: "phase",
      phaseID: "plan",
      title: "Plan",
    })

    expect(buildPhaseChildForStep(step, { [build.id]: build, [plan.id]: plan })).toBe(build)
    expect(visibleChildIDsForCard(step, { [build.id]: build, [plan.id]: plan })).toEqual([plan.id])
  })

  test("promotes build phase status and usage onto the step header node", () => {
    const step = card({
      id: "step:g1:build",
      kind: "step",
      title: "Goal",
      status: "running",
      usage: { totalTokens: 10 },
      childIDs: ["step:g1:build:phase:build"],
    })
    const build = card({
      id: "step:g1:build:phase:build",
      kind: "phase",
      phaseID: "build",
      title: "Build",
      status: "completed",
      usage: { inputTokens: 20, outputTokens: 30, totalTokens: 50, costUSD: 0.25 },
      contextTokens: 4000,
      contextTokensEstimated: true,
      timeCompleted: 6,
      errorReason: "done",
    })

    const headerNode = stepHeaderNodeWithBuildPhase(step, { [build.id]: build })

    expect(headerNode.id).toBe(step.id)
    expect(headerNode.title).toBe(step.title)
    expect(headerNode.status).toBe("completed")
    expect(headerNode.usage).toEqual(build.usage)
    expect(headerNode.contextTokens).toBe(4000)
    expect(headerNode.contextTokensEstimated).toBe(true)
    expect(headerNode.timeCompleted).toBe(6)
    expect(headerNode.errorReason).toBe("done")
  })

  test("keeps completed executor step expanded when promoted build output exists", () => {
    const step = card({
      id: "step:g1:build",
      kind: "step",
      title: "Goal",
      status: "completed",
      childIDs: ["step:g1:build:phase:build"],
    })
    const emptyBuild = card({
      id: "step:g1:build:phase:build",
      kind: "phase",
      phaseID: "build",
      title: "Build",
      status: "completed",
      parts: [{ type: "boundary", messageID: "m1", role: "build", roleLabel: "Build" }],
    })
    const buildWithOutput = card({
      ...emptyBuild,
      parts: [...(emptyBuild.parts || []), { id: "p1", messageID: "m1", type: "text", text: "Build finished." }],
    })

    expect(defaultExpandedForNode(step, { [emptyBuild.id]: emptyBuild })).toBe(false)
    expect(defaultExpandedForNode(step, { [buildWithOutput.id]: buildWithOutput })).toBe(true)
  })

  test("rejects malformed step children instead of hiding broken card state", () => {
    const missing = card({
      id: "step:g1:build",
      kind: "step",
      title: "Goal",
      childIDs: ["missing"],
    })
    expect(() => visibleChildIDsForCard(missing, {})).toThrow("references missing child missing")

    const nonStepMissing = card({
      id: "phase:g1:plan",
      kind: "phase",
      title: "Plan",
      childIDs: ["missing"],
    })
    expect(() => visibleChildIDsForCard(nonStepMissing, {})).toThrow("references missing child missing")

    const duplicate = card({
      id: "step:g1:build",
      kind: "step",
      title: "Goal",
      childIDs: ["build-a", "build-b"],
    })
    const buildA = card({ id: "build-a", kind: "phase", phaseID: "build", title: "Build A" })
    const buildB = card({ id: "build-b", kind: "phase", phaseID: "build", title: "Build B" })
    expect(() => buildPhaseChildForStep(duplicate, { [buildA.id]: buildA, [buildB.id]: buildB })).toThrow(
      "multiple build phase children",
    )
  })
})
