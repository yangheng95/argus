// ── Reasoning Visibility Store ──
// Exact port of the Reasoning Visibility section from app.js (lines 211–286).
// Manages per-part auto-hide timers and visibility state.
//
// In app.js the visibility changes propagate by mutating
// state.conversationUpdatedAt and calling renderConversation(). In the Solid
// world we expose a reactive `reasoningRevision` signal instead: Solid
// components that render reasoning parts should read this signal so they
// automatically re-render when visibility changes.

import { createSignal } from "solid-js";

// ── Types ──

interface ReasoningEntry {
  hidden: boolean;
}

// ── Internal state ──

// Visibility map: key → { hidden }
// Using plain Maps (not reactive) mirrors app.js; reactivity is provided
// by the reasoningRevision signal below.
const reasoningVisibility = new Map<string, ReasoningEntry>();
const reasoningHideTimers = new Map<string, ReturnType<typeof setTimeout>>();

const DEFAULT_REASONING_AUTO_CLOSE_MS = 5000;

// ── Reactive revision counter ──
// Increment this whenever visibility changes so that any Solid component that
// reads reasoningRevision() will automatically re-run its reactive computation.

const [reasoningRevision, setReasoningRevision] = createSignal(0);

/** Read the current revision counter (reactive accessor). */
export { reasoningRevision };

// ── Helpers ──

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Derive a stable cache key from a reasoning part object. */
export function reasoningPartKey(part: unknown): string {
  if (!record(part)) return "";
  const id = typeof (part as any).id === "string" ? (part as any).id : "";
  const messageID =
    typeof (part as any).messageID === "string" ? (part as any).messageID : "";
  const sessionID =
    typeof (part as any).sessionID === "string" ? (part as any).sessionID : "";
  if (!id && !messageID && !sessionID) return "";
  return `reasoning:${sessionID}:${messageID}:${id}`;
}

/** Return true if the reasoning part is currently hidden. */
export function reasoningPartHidden(part: unknown): boolean {
  const key = reasoningPartKey(part);
  return key ? reasoningVisibility.get(key)?.hidden === true : false;
}

/**
 * Read the auto-close delay in milliseconds.
 * Reads from window.__overlayTest.reasoningAutoCloseMs when present,
 * otherwise returns the hard-coded default (5000 ms).
 */
export function reasoningAutoCloseMs(): number {
  const testConfig = (window as any).__overlayTest;
  const value =
    testConfig && typeof testConfig === "object"
      ? Number(testConfig.reasoningAutoCloseMs)
      : NaN;
  if (Number.isFinite(value)) return Math.max(0, Math.floor(value));
  return DEFAULT_REASONING_AUTO_CLOSE_MS;
}

/** Cancel any pending auto-hide timer for the given key. */
export function stopReasoningHideTimer(key: string): void {
  const timer = reasoningHideTimers.get(key);
  if (!timer) return;
  clearTimeout(timer);
  reasoningHideTimers.delete(key);
}

/**
 * Schedule an auto-hide for the reasoning part identified by `key`.
 * Any existing timer for the same key is cancelled first.
 */
export function scheduleReasoningAutoHide(key: string): void {
  if (!key) return;
  stopReasoningHideTimer(key);
  const timer = setTimeout(() => {
    reasoningHideTimers.delete(key);
    const current = reasoningVisibility.get(key) || { hidden: false };
    if (current.hidden) return;
    reasoningVisibility.set(key, { ...current, hidden: true });
    setReasoningRevision((r) => r + 1);
  }, reasoningAutoCloseMs());
  reasoningHideTimers.set(key, timer);
}

/**
 * Mark a reasoning part as visible and reset its auto-hide timer.
 * If the part was previously hidden, increments the reactive revision counter
 * so that Solid components re-render.
 */
export function touchReasoningPart(part: unknown): void {
  const key = reasoningPartKey(part);
  if (!key) return;
  const current = reasoningVisibility.get(key);
  reasoningVisibility.set(key, { ...(current || {}), hidden: false });
  stopReasoningHideTimer(key);
  scheduleReasoningAutoHide(key);
  if (current?.hidden) {
    setReasoningRevision((r) => r + 1);
  }
}
