// ── DOM Utilities ──
// Responsibilities:
// - jsonAttr: safely serialize a value to a JSON string for use in an
// HTML attribute (
// - eventClosest: walk from an event's target to the nearest ancestor
// matching a CSS selector (
// - sizeChat: auto-resize the chat textarea to its content, clamped between
// CSS-variable-defined min and max heights (
// lines 9164–9171).
// - ensureTaskSelection: select the first available task when no task is
// currently selected (
// The functions that operate on the DOM (#chatTextarea, task state) do so via
// document.getElementById / window globals so that no circular imports are
// introduced during the Solid migration.

import { boardStore } from "../store/board";
import { selectTask } from "../services/task";
import { settingsStore } from "../store/settings";
import { t } from "./i18n";
import { escapeHtml } from "./markdown";
export { sanitizeDirectoryMode } from "../store/settings";

// ── Auto-scroll ──

/**
 * Set up auto-scroll-to-bottom on a scrollable container.
 *
 * Behavior:
 * - Automatically scrolls to the bottom when new content appears
 * - If the user scrolls up, auto-scroll pauses
 * - When the user scrolls back to the bottom, auto-scroll resumes
 *
 * Uses MutationObserver to detect DOM changes (works with SolidJS reactivity).
 * Returns a cleanup function that removes the listener and disconnects the observer.
 */
export function setupAutoScroll(el: HTMLElement, threshold = 60): () => void {
  let tracking = true;

  function onScroll() {
    tracking = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }

  function scrollDown() {
    if (tracking) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }

  el.addEventListener("scroll", onScroll, { passive: true });

  const observer = new MutationObserver(scrollDown);
  observer.observe(el, { childList: true, subtree: true, characterData: true });

  // Initial scroll to bottom
  scrollDown();

  return () => {
    el.removeEventListener("scroll", onScroll);
    observer.disconnect();
  };
}

// ── Public API ──

/**
 * Serialize `value` to a JSON string suitable for embedding in an HTML
 * attribute. The value is first coerced to a string via String() so that
 * primitives (numbers, booleans) and null/undefined all produce predictable
 * output.
 * @example
 * // In a template literal:
 * `<div data-id=${jsonAttr(task.id)}>`
 */
export function jsonAttr(value: unknown): string {
  return JSON.stringify(String(value ?? ""));
}

/**
 * Return the nearest ancestor of `event.target` that matches `selector`, or
 * `null` if none is found.
 * Handles the case where the event target is not an Element (e.g. a Text node)
 * by falling back to the target's parentElement.
 */
export function eventClosest(
  event: Event,
  selector: string,
): Element | null {
  const target = event?.target;
  if (target instanceof Element) return target.closest(selector);
  const parent = (target as Node | null)?.parentElement;
  if (parent instanceof Element) return parent.closest(selector);
  return null;
}

/**
 * Resize the chat textarea to fit its current content.
 * The height is set to "auto" first so that scrollHeight reflects the natural
 * content height, then clamped between `--ui-chat-min-height` (default 72 px)
 * and `--ui-chat-max-height` (default 180 px) from the document root's
 * computed style.
 * When a `textarea` argument is provided it is resized directly; otherwise
 * the function queries `#chatTextarea` from the live DOM.
 */
export function sizeChat(textarea?: HTMLTextAreaElement): void {
  const el =
    textarea ??
    (document.getElementById("chatTextarea") as HTMLTextAreaElement | null);
  if (!el) return;

  el.style.height = "auto";

  const style = getComputedStyle(document.documentElement);
  const min =
    Number.parseFloat(style.getPropertyValue("--ui-chat-min-height")) || 72;
  const max =
    Number.parseFloat(style.getPropertyValue("--ui-chat-max-height")) || 180;

  const h = Math.min(el.scrollHeight, max);
  el.style.height = `${Math.max(h, min)}px`;
}

/**
 * Ensure that at least one task is selected.
 * If a workspace selection already exists (checked
 * `hasWorkspaceSelection` window global) this is a no-op and returns `false`.
 * Otherwise the first task in boardStore.tasks is selected and `true` is
 * returned. Returns `false` if there are no tasks available.
 */
export async function ensureTaskSelection(): Promise<boolean> {
  const { hasWorkspaceSelection } = await import("../services/workspace");
  if (hasWorkspaceSelection()) {
    return false;
  }

  const tasks = boardStore.tasks as any[];
  const taskID = tasks[0]?.task?.id || "";
  if (!taskID) return false;

  await selectTask(taskID);
  return true;
}

// ── Path Utilities ──
// (lines 4125–4218).

/**
 * Decompose a file-system path string into an array of label/path objects,
 * one per component. Handles Windows absolute paths (e.g. `C:\`), Unix
 * absolute paths, and relative paths.
 */
export function pathItems(value: string): Array<{ label: string; path: string }> {
  const text = String(value || "").trim();
  if (!text) return [];
  const windows = /^[A-Za-z]:[\\/]/.test(text);
  const unix = text.startsWith("/");
  const parts = text.split(/[\\/]+/).filter(Boolean);
  if (!parts.length) return [];

  function joinPath(a: string, b: string): string {
    return a.replace(/[\\/]+$/, "") + "/" + b;
  }

  if (windows) {
    let path = `${parts[0]}\\`;
    const items: Array<{ label: string; path: string }> = [{ label: parts[0], path }];
    return items.concat(
      parts.slice(1).map((part) => {
        path = joinPath(path, part);
        return { label: part, path };
      }),
    );
  }
  if (unix) {
    let path = "/";
    const items: Array<{ label: string; path: string }> = [{ label: "/", path }];
    return items.concat(
      parts.map((part) => {
        path = path === "/" ? `/${part}` : `${path}/${part}`;
        return { label: part, path };
      }),
    );
  }
  let path = parts[0];
  const items: Array<{ label: string; path: string }> = [{ label: parts[0], path }];
  return items.concat(
    parts.slice(1).map((part) => {
      path = path.replace(/[\\/]+$/, "") + "/" + part;
      return { label: part, path };
    }),
  );
}

/**
 * Return an inline SVG string for the given path-action button kind.
 * Supported kinds: "browse" | "new" | "history" | any (returns × close icon).
 */
export function pathIcon(kind: string): string {
  if (kind === "browse") {
    return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 4.5h4l1.2 1.5h5.8v5.2a1.3 1.3 0 01-1.3 1.3H3.8a1.3 1.3 0 01-1.3-1.3V5.8a1.3 1.3 0 011.3-1.3z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
    </svg>`;
  }
  if (kind === "new") {
    return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 3.2v9.6M3.2 8h9.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    </svg>`;
  }
  if (kind === "history") {
    return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 4v4l2.5 1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M3.05 8a5 5 0 1 1 .5 2.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
      <path d="M3 10.5L3.05 8 1 9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }
  return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
  </svg>`;
}

/**
 * Build the HTML string for the directory breadcrumb bar shown in the task
 * header. Reads the current directory from `settingsStore.directory`.
 */
export function pathBreadcrumb(value: string): string {
  const browse = escapeHtml(t("cwd.browse"));
  const create = escapeHtml(t("cwd.new"));
  const reset = escapeHtml(t("cwd.reset"));
  const recent = escapeHtml(t("cwd.recent"));
  const directory = settingsStore.directory;
  const actions = [
    `<button type="button" class="task-dir-tool" data-path-action="recent" title="${recent}" aria-label="${recent}">${pathIcon("history")}</button>`,
    `<button type="button" class="task-dir-tool" data-path-action="browse" title="${browse}" aria-label="${browse}">${pathIcon("browse")}</button>`,
    `<button type="button" class="task-dir-tool" data-path-action="create" title="${create}" aria-label="${create}">${pathIcon("new")}</button>`,
    directory
      ? `<button type="button" class="task-dir-tool danger" data-path-action="reset" title="${reset}" aria-label="${reset}">${pathIcon("reset")}</button>`
      : "",
  ]
    .filter(Boolean)
    .join("");
  if (!value) {
    return `
      <span class="task-dir-shell" data-empty="true">
        <span class="task-dir-empty">${escapeHtml(t("cwd.unavailable"))}</span>
        <span class="task-dir-actions">${actions}</span>
      </span>
    `;
  }
  const items = pathItems(value);
  const open = t("cwd.open");
  const choose = t("cwd.choose_level");
  const nodes = items
    .map((item, index) => {
      const current = index === items.length - 1 ? ' data-current="true"' : "";
      const step = index
        ? `<button type="button" class="task-dir-step" data-path-set=${jsonAttr(items[index - 1].path)} title="${escapeHtml(`${choose}: ${items[index - 1].path}`)}" aria-label="${escapeHtml(`${choose}: ${items[index - 1].path}`)}">/</button>`
        : "";
      return `${step}<button type="button" class="task-dir-node" data-path-open=${jsonAttr(item.path)} title="${escapeHtml(`${open}: ${item.path}`)}" aria-label="${escapeHtml(`${open}: ${item.path}`)}"${current}>${escapeHtml(item.label)}</button>`;
    })
    .join("");
  return `
    <span class="task-dir-shell">
      <span class="task-dir-path">${nodes}</span>
      <span class="task-dir-actions">${actions}</span>
    </span>
  `;
}
