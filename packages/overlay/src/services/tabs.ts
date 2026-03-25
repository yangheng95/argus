// ── Tabs Service ──
// Exact port of isCodingTab / switchTab from app.js (lines 11352–11369).
//
// app.js references covered:
//   - coding.active              (module-level boolean, mirrors legacy `coding` object)
//   - isCodingTab()              (returns current active state)
//   - switchTab(tab)             (toggles DOM classes and visibility)
//
// The legacy `coding` object is fully managed by CodingTab.tsx (Solid
// component) for its internal message/session/busy state.  Only the
// `active` flag is tracked here because switchTab is called from outside
// the Solid component tree (e.g. the modeToggle click handler in app.js).

import { t } from "../utils/i18n";
import { messageStore } from "../store/messages";

// ── Module-level tab state (mirrors app.js coding.active) ──

let codingActive = false;

// ── Public API ──

/**
 * Return whether the Coding tab is currently active.
 * Exact port of app.js isCodingTab().
 */
export function isCodingTab(): boolean {
  return codingActive;
}

/**
 * Switch the active tab between "control" (chat) and "coding".
 * Exact port of app.js switchTab(tab).
 *
 * Operates on the live DOM using the same element IDs as the legacy HTML:
 *   #tabControl, #tabCoding, #chatScroll, #codingScroll,
 *   #chatGoalsStrip, #taskStatus, #modeToggle
 */
export function switchTab(tab: "control" | "coding"): void {
  codingActive = tab === "coding";

  const tabControl = document.getElementById("tabControl");
  const tabCoding = document.getElementById("tabCoding");
  const chatScroll = document.getElementById("chatScroll");
  const codingScroll = document.getElementById("codingScroll");
  const chatGoalsStrip = document.getElementById("chatGoalsStrip");
  const taskStatus = document.getElementById("taskStatus");
  const toggle = document.getElementById("modeToggle");

  if (tabControl) tabControl.classList.toggle("active", !codingActive);
  if (tabCoding) tabCoding.classList.toggle("active", codingActive);
  if (chatScroll) (chatScroll as HTMLElement).hidden = codingActive;
  if (codingScroll) (codingScroll as HTMLElement).hidden = !codingActive;
  if (chatGoalsStrip) (chatGoalsStrip as HTMLElement).hidden = codingActive;

  // Hide task-specific header elements in coding mode
  if (taskStatus) {
    (taskStatus as HTMLElement).hidden =
      codingActive || !messageStore.selectedTaskID;
  }

  // Update toggle button text
  if (toggle) {
    toggle.textContent = codingActive ? "Build" : t("chat.title");
  }
}
