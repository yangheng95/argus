// ── Managed Session Service ──
// TypeScript.
// Background
// ----------
// The overlay no longer supports "session workspace" mode. createManagedSession,
// openManagedSession, and selectManagedSession are kept as named exports so that
// call-sites compiled from the old API surface continue to resolve, but each
// function throws an explicit error to make any accidental call-through visible
// during development.
// The interaction handlers (resolveInteraction, rejectInteraction,
// showInteractionError) delegate to the interactions controller that is
// instantiated. This avoids duplicating the
// busy-lock / button-disable / loadBoard logic already present in
// interactions.ts while the migration is in progress.
// Mirrors:
// - createManagedSession (line 7209–7211)
// - openManagedSession (line 7213–7215)
// - selectManagedSession (line 7217–7219)
// - resolveInteraction (lines 7225–7227)
// - rejectInteraction (lines 7229–7231)
// - showInteractionError (lines 7233–7244)
// Integration:
// - resolveInteraction / rejectInteraction delegate to window-scoped helpers
// that wrap the createOverlayInteractions controller.
// - showInteractionError performs direct DOM manipulation identical to the
// implementation so it can be called before the Solid component tree
// is fully mounted.

import { t } from "../utils/i18n";

// ── Internal: unsupported guard ──

/**
 * Throw a consistent error when removed session-workspace APIs are invoked.
 */
function unsupportedSessionWorkspace(): never {
  throw new Error(
    "Overlay no longer supports session workspaces; use tasks instead.",
  );
}

// ── Session-workspace stubs (removed feature) ──

/**
 * Session workspaces are not supported.
 * Use the task-based API (createTask / selectTask) instead.
 */
export async function createManagedSession(): Promise<string> {
  unsupportedSessionWorkspace();
}

/**
 * Session workspaces are not supported.
 * Use the task-based API instead.
 */
export async function openManagedSession(
  _sessionID: string,
  _input: unknown,
): Promise<void> {
  unsupportedSessionWorkspace();
}

/**
 * Session workspaces are not supported.
 * Use selectTask from services/task instead.
 */
export async function selectManagedSession(
  _sessionID: string,
  _input: unknown = {},
): Promise<void> {
  unsupportedSessionWorkspace();
}

// ── Public: interaction handlers ──

/**
 * Resolve a pending interaction by delegating to the window-scoped
 * interactions controller that was initialised.
 * `action` is one of: "always", "once", "answer".
 * `input` may carry `{ answers, message }` for question interactions.
 */
export async function resolveInteraction(
  id: string,
  action: string,
  input: Record<string, unknown> = {},
): Promise<void> {
  const fn = (window as any).resolveInteraction;
  if (typeof fn !== "function") {
    console.error(
      "[session] resolveInteraction not available on window — interactions controller not yet initialised",
    );
    return;
  }
  return fn(id, action, input);
}

/**
 * Reject a pending interaction by delegating to the window-scoped
 * interactions controller that was initialised.
 */
export async function rejectInteraction(id: string): Promise<void> {
  const fn = (window as any).rejectInteraction;
  if (typeof fn !== "function") {
    console.error(
      "[session] rejectInteraction not available on window — interactions controller not yet initialised",
    );
    return;
  }
  return fn(id);
}

/**
 * Display an error message on an interaction alert card and re-enable its
 * action buttons so the user can retry.
 * Operates directly on the DOM — finds the `.interaction-alert[data-id]`
 * element, updates its title to the error text (via the i18n key
 * "interaction.error"), and clears the disabled/opacity state from every
 * `<button>` inside it.
 */
export function showInteractionError(id: string, msg: string): void {
  const alert = document.querySelector(
    `.interaction-alert[data-id="${id}"]`,
  ) as HTMLElement | null;
  if (!alert) return;

  const title = alert.querySelector(".interaction-title");
  if (title) {
    title.textContent = t("interaction.error", { message: msg });
  }

 // Re-enable buttons so the user can retry
  alert.querySelectorAll("button").forEach((btn) => {
    const el = btn as HTMLButtonElement;
    el.disabled = false;
    el.style.opacity = "";
  });
}
