export function goalStepStatus(goal: any, stepID: string): string {
  return goal?.steps?.find((step: any) => step?.stepID === stepID)?.status ?? "pending";
}

export function goalStepDone(goal: any, stepID: string): boolean {
  return goalStepStatus(goal, stepID) === "completed";
}

export function acceptanceGoalProgress(goals: any[]): { completed: number; failed: number; total: number } {
  const list = Array.isArray(goals) ? goals : [];
  let completed = 0;
  let failed = 0;
  for (const goal of list) {
    if (goalStepDone(goal, "build") || goal?.goalStatus === "passed") completed += 1;
    if (goalStepStatus(goal, "build") === "failed") failed += 1;
  }
  return { completed, failed, total: list.length };
}
