export function goalStageStepID(stage: string): string | null {
  const normalized = String(stage || "").trim().toLowerCase();
  if (
    normalized === "planner" ||
    normalized === "executor" ||
    normalized === "build" ||
    normalized === "evaluator"
  ) {
    return "build";
  }
  return null;
}
