// Collapse arbitrary stage names into the four card visual roles. Stage text
// remains on the card; only colour selection is constrained to this single
// role taxonomy.

export type CardRole = "user" | "system" | "execution" | "review";

const ROLE_BY_STAGE = new Map<string, CardRole>([
  ["user", "user"],
  ["assistant", "user"],
  ["orchestrator", "system"],
  ["spec", "system"],
  ["requirements", "system"],
  ["design-analyst", "system"],
  ["architect", "system"],
  ["planner", "system"],
  ["goal", "execution"],
  ["executor", "execution"],
  ["build", "execution"],
  ["tool", "execution"],
  ["evaluator", "review"],
  ["delivery", "review"],
  ["integrity", "review"],
]);

export function roleOf(stage: string | undefined | null): CardRole {
  const key = String(stage || "").trim();
  return ROLE_BY_STAGE.get(key) ?? "system";
}
