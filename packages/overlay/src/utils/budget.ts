// ── Budget Utilities ──
// Exported functions / types:
// Budget — interface describing a task budget object
// sameBudget — deep-equality comparison of two Budget objects
// budgetMinutes — convert a millisecond wall-time value to a display string
// budgetNumber — parse a numeric value from an <input> element
// draftBudget — read the current budget form inputs into a Budget object
// These helpers operate on the live DOM (document.getElementById) where needed
// so that they can remain decoupled from the Solid store during migration.

// ── Types ──

export interface Budget {
  maxRuns?: number;
  maxEvaluations?: number;
  /** Wall-time limit in milliseconds */
  maxWallTimeMs?: number;
  /** Max concurrent goal executor groups */
  maxExecutorGroups?: number;
}

// ── sameBudget ──
// Returns true when two budget objects are structurally identical (including
// undefined fields) via JSON serialisation.

export function sameBudget(a: Budget | null | undefined, b: Budget | null | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

// ── budgetMinutes ──
// Convert a millisecond wall-time value to a human-readable minutes string.
// Returns "" for non-positive or non-finite inputs.

export function budgetMinutes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  const next = Math.round((value / 60000) * 10) / 10;
  return Number.isInteger(next) ? String(next) : next.toFixed(1);
}

// ── budgetNumber ──
// Read a numeric value from an HTMLInputElement and return it as a number, or
// undefined if the input is absent/empty/invalid.
// Options:
// allowZero — when true, 0 is a valid value; when false (default), 0 is
// treated as absent and returns undefined.
// scale — multiply the raw number before returning (e.g. 60000 to
// convert minutes → ms).

export interface BudgetNumberOptions {
  allowZero?: boolean;
  scale?: number;
}

export function budgetNumber(
  input: HTMLInputElement | null | undefined,
  options: BudgetNumberOptions = {},
): number | undefined {
  const text = input?.value?.trim() || "";
  if (!text) return undefined;
  const value = Number(text);
  if (!Number.isFinite(value)) return undefined;
  if (options.allowZero ? value < 0 : value <= 0) return undefined;
  return Math.round(value * (options.scale || 1));
}

// ── draftBudget ──
// Read the current values of the four budget form inputs and return a Budget
// object, or undefined when all inputs are empty/invalid.

export function draftBudget(): Budget | undefined {
  const budget: Budget = {
    maxRuns: budgetNumber(
      document.getElementById("budgetMaxRuns") as HTMLInputElement | null,
    ),
    maxEvaluations: budgetNumber(
      document.getElementById("budgetMaxEvaluations") as HTMLInputElement | null,
    ),
    maxWallTimeMs: budgetNumber(
      document.getElementById("budgetMaxWallTime") as HTMLInputElement | null,
      { scale: 60000 },
    ),
    maxExecutorGroups: budgetNumber(
      document.getElementById("budgetMaxExecutorGroups") as HTMLInputElement | null,
    ),
  };
  if (Object.values(budget).every((v) => v === undefined)) return undefined;
  return budget;
}
