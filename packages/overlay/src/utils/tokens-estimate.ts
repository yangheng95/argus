// ── Local token estimation ──
// Provider-reported `tokens.input` is authoritative but only arrives on the
// LLM response. For in-progress turns, user bubbles and synthetic entries we
// still want to surface *something* so the operator can gauge how much
// context is on the wire. This module produces a conservative chars/token
// approximation; consumers label the resulting value with "est." so the user
// knows it's not a billing figure.

/** Rough chars-per-token. English averages ~4, CJK averages ~1.5; 3 is a
 *  balanced midpoint that undershoots slightly so we don't inflate the
 *  number relative to the provider's own cumulative count. */
const CHARS_PER_TOKEN = 3;

function charsOf(value: any): number {
  return typeof value === "string" ? value.length : 0;
}

function safeJsonLen(v: any): number {
  try {
    return JSON.stringify(v).length;
  } catch {
    return 0;
  }
}

export function estimatePartChars(part: any): number {
  if (!part) return 0;
  const t = part.type;
  if (t === "text" || t === "reasoning") return charsOf(part.text);
  if (t === "tool") {
    const s = part.state || {};
    let c = 0;
    if (s.input !== undefined) c += safeJsonLen(s.input);
    if (s.output !== undefined) c += charsOf(s.output);
    if (s.error !== undefined) c += charsOf(s.error);
    if (s.metadata !== undefined) c += safeJsonLen(s.metadata);
    return c;
  }
  if (t === "file") return charsOf(part.path) + charsOf(part.url);
  if (t === "patch") return charsOf(part.patch) + charsOf(part.text);
  if (t === "compaction") return charsOf(part.summary) + charsOf(part.text);
  if (t === "subtask") return charsOf(part.title) + charsOf(part.text);
  return 0;
}

export function estimateMessageChars(message: any): number {
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  let n = 0;
  for (const p of parts) n += estimatePartChars(p);
  return n;
}

export function charsToTokens(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/** Provider-reported cumulative context tokens for this message, if any. */
export function providerContextTokens(message: any): number | undefined {
  const v = message?.info?.tokens?.input;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  return undefined;
}