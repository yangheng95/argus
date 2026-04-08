// ── Budget Utilities ──
// Exported functions / types:
// Budget — interface describing a task budget object
// sameBudget — deep-equality comparison of two Budget objects
// budgetNumber — parse a numeric value from an <input> element
// draftBudget — read the current budget form inputs into a Budget object
// These helpers operate on the live DOM (document.getElementById) where needed
// so that they can remain decoupled from the Solid store during migration.

// ── Types ──

export interface Budget {
  maxRuns?: number;
  /** Max concurrent goal executor groups */
  maxExecutorGroups?: number;
}

// ── sameBudget ──
// Returns true when two budget objects are structurally identical (including
// undefined fields) via JSON serialisation.

export function sameBudget(a: Budget | null | undefined, b: Budget | null | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
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
// Read the current values of the budget form inputs and return a Budget
// object, or undefined when all inputs are empty/invalid.

export function draftBudget(): Budget | undefined {
  const budget: Budget = {
    maxRuns: budgetNumber(
      document.getElementById("budgetMaxRuns") as HTMLInputElement | null,
    ),
    maxExecutorGroups: budgetNumber(
      document.getElementById("budgetMaxExecutorGroups") as HTMLInputElement | null,
    ),
  };
  if (Object.values(budget).every((v) => v === undefined)) return undefined;
  return budget;
}
