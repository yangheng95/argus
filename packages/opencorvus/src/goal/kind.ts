export function isDispatchableGoalKind(kind: string | null | undefined): boolean {
  return kind !== "verification"
}

export function isDispatchableGoal(input: { kind?: string | null | undefined }): boolean {
  return isDispatchableGoalKind(input.kind)
}
