// Resolve an accent colour for a card's stage. Known stages reference the
// per-stage CSS variables defined in card.css so theme switches keep working;
// unknown stages (custom subagents, new built-ins not yet hard-coded in CSS)
// fall back to a deterministic HSL derived from the stage name, so any given
// stage stays the same colour across sessions.

const KNOWN_STAGES = new Set([
  "user",
  "assistant",
  "system",
  "orchestrator",
  "mission",
  "intent-analysis",
  "spec",
  "requirements",
  "design-analyst",
  "architect",
  "planner",
  "goal",
  "executor",
  "build",
  "explore",
  "evaluator",
  "delivery",
  "integrity",
  "fact-check",
  "tool",
]);

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return h;
}

export function stageAccent(stage: string | undefined | null): string | undefined {
  if (!stage) return undefined;
  const s = String(stage).trim();
  if (!s) return undefined;
  if (KNOWN_STAGES.has(s)) return `var(--card-stage-${s})`;
  const hue = Math.abs(hashString(s)) % 360;
  return `hsl(${hue} 58% 66%)`;
}
