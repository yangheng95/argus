import { createDecisionLog } from "@/decision-log"

const ARCHITECT_CONTRACT_VALUE_CAP = 4_000

function hasContent(section: string): boolean {
  return section.trim().length > 0
}

export function buildGoalUpstreamAgentContextSections(taskID: string, goalID: string): string[] {
  const decisionLog = createDecisionLog(taskID)
  return [
    decisionLog.phasePromptSectionForGoal("requirements", goalID, "Requirements Decisions"),
    decisionLog.phasePromptSectionForGoal("design_analysis", goalID, "Design Analysis Summary"),
    decisionLog.phasePromptSectionForGoal(
      "architect",
      goalID,
      "Architect Consensus",
      { valueCap: ARCHITECT_CONTRACT_VALUE_CAP },
    ),
  ].filter(hasContent)
}

export function buildTaskUpstreamAgentContextSections(taskID: string): string[] {
  const decisionLog = createDecisionLog(taskID)
  return [
    decisionLog.phasePromptSection("requirements", "Requirements Decisions"),
    decisionLog.phasePromptSection("design_analysis", "Design Analysis Summary"),
    decisionLog.phasePromptSection(
      "architect",
      "Architect Consensus",
      { valueCap: ARCHITECT_CONTRACT_VALUE_CAP },
    ),
  ].filter(hasContent)
}