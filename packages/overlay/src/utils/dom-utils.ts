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
import { hasWorkspaceSelection, QUICK_PROJECT_EDITORS } from "../services/workspace";
import { t } from "./i18n";
import { escapeHtml } from "./markdown";

// ── Auto-scroll ──

/**
 * Set up user-controlled follow-to-bottom on a scrollable container.
 *
 * Behavior:
 * - Tracking state is owned by the caller (accessor `isTracking`). When true,
 *   new content triggers an rAF scroll-to-bottom; when false the container
 *   is left alone so the user can read without the viewport jumping.
 * - When tracking is ON and the user manually scrolls away from the bottom,
 *   `onUserScrollUp` is invoked so the caller can flip tracking off.
 * - On initial mount the container snaps to the bottom once, regardless of
 *   tracking state, so the user lands on the latest content.
 * - `scrollToBottom` on the returned controller jumps to the bottom without
 *   being mis-classified as a user scroll (used when the caller turns
 *   tracking on again).
 * - `scrollToTop` mirrors that behavior for explicit jumps to the start of
 *   the transcript without polluting user-scroll detection.
 *
 * Program-initiated scrolls (our own scrollTop writes) are distinguished
 * from user scrolls by tracking the last landing position we set. Scroll
 * events that land within `PROGRAM_TOLERANCE` px of that position are
 * treated as program-echo and never fire `onUserScrollUp`.
 *
 * Follow-lock should only drop on likely user-driven upward scrolls. Reflow,
 * focus management, or other programmatic scrollTop changes must not disable
 * tracking, so we also require a recent scroll intent signal.
 */
const BOTTOM_TOLERANCE = 8;
const PROGRAM_TOLERANCE = 2;
const USER_SCROLL_INTENT_WINDOW_MS = 250;
const USER_SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
  "Spacebar",
]);

export interface AutoScrollOptions {
  isTracking: () => boolean;
  onUserScrollUp: () => void;
}

export interface AutoScrollController {
  cleanup: () => void;
  scrollToBottom: () => void;
  scrollToTop: () => void;
}

export function setupAutoScroll(
  el: HTMLElement,
  opts: AutoScrollOptions,
): AutoScrollController {
  let rafPending = false;
  let expectedTop = el.scrollTop;
  const observedChildren = new Set<Element>();
  let lastUserScrollIntentAt = Number.NEGATIVE_INFINITY;

  function nowMs(): number {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }

  function markUserScrollIntent() {
    lastUserScrollIntentAt = nowMs();
  }

  function hasRecentUserScrollIntent(): boolean {
    return nowMs() - lastUserScrollIntentAt <= USER_SCROLL_INTENT_WINDOW_MS;
  }

  function onWheel() {
    markUserScrollIntent();
  }

  function onTouchMove() {
    markUserScrollIntent();
  }

  function onPointerDown(event: PointerEvent) {
    if (event.target === el) markUserScrollIntent();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.defaultPrevented) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (USER_SCROLL_KEYS.has(event.key)) markUserScrollIntent();
  }

  function distanceFromBottom(): number {
    return el.scrollHeight - el.clientHeight - el.scrollTop;
  }

  function syncResizeTargets() {
    const nextChildren = new Set(Array.from(el.children));
    for (const child of nextChildren) {
      if (observedChildren.has(child)) continue;
      resizeObserver.observe(child);
      observedChildren.add(child);
    }
    for (const child of Array.from(observedChildren)) {
      if (nextChildren.has(child)) continue;
      resizeObserver.unobserve(child);
      observedChildren.delete(child);
    }
  }

  function onScroll() {
    const nextTop = el.scrollTop;
    const delta = nextTop - expectedTop;
    if (Math.abs(delta) <= PROGRAM_TOLERANCE) {
      expectedTop = nextTop;
      return;
    }
    const movedUp = delta < -PROGRAM_TOLERANCE;
    expectedTop = nextTop;
    if (
      opts.isTracking() &&
      movedUp &&
      hasRecentUserScrollIntent() &&
      distanceFromBottom() > BOTTOM_TOLERANCE
    ) {
      opts.onUserScrollUp();
    }
  }

  function scrollDown() {
    if (!opts.isTracking() || rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      if (!opts.isTracking()) return;
      el.scrollTop = el.scrollHeight;
      expectedTop = el.scrollTop;
    });
  }

  el.addEventListener("wheel", onWheel, { passive: true });
  el.addEventListener("touchmove", onTouchMove, { passive: true });
  el.addEventListener("pointerdown", onPointerDown, { passive: true });
  el.addEventListener("keydown", onKeyDown);
  el.addEventListener("scroll", onScroll, { passive: true });

  const resizeObserver = new ResizeObserver(scrollDown);
  resizeObserver.observe(el);
  syncResizeTargets();

  const mutationObserver = new MutationObserver((records) => {
    if (records.some((record) => record.type === "childList")) {
      syncResizeTargets();
    }
    scrollDown();
  });
  // childList:true is enough — every text mutation that grows the
  // scrollHeight (TextPart's appendChild of frozen blocks, Card's
  // structural updates) shows up as a childList record. The previously
  // enabled `characterData: true` fired the callback for every SSE
  // token tick on top of that, producing a callback storm during
  // streaming (50ms flush × per-character text mutations on the active
  // tail block). The ResizeObserver above already catches scrollHeight
  // grows from in-place text edits, so dropping characterData costs
  // zero correctness and removes the high-frequency redundant work.
  mutationObserver.observe(el, { childList: true, subtree: true });

  requestAnimationFrame(() => {
    el.scrollTop = el.scrollHeight;
    expectedTop = el.scrollTop;
  });

  return {
    cleanup: () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("scroll", onScroll);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      observedChildren.clear();
    },
    scrollToBottom: () => {
      el.scrollTop = el.scrollHeight;
      expectedTop = el.scrollTop;
    },
    scrollToTop: () => {
      el.scrollTop = 0;
      expectedTop = el.scrollTop;
    },
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
 * Supported kinds: "browse" | "new" | any (returns × close icon).
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
  const editorActions = QUICK_PROJECT_EDITORS.map((editor) => {
    const label = escapeHtml(t("cwd.open_in_editor", { name: editor.label }));
    return `<button type="button" class="task-dir-tool task-dir-editor" data-path-editor=${jsonAttr(editor.id)} title="${label}" aria-label="${label}"><span class="task-dir-tool-label">${escapeHtml(editor.shortLabel)}</span></button>`;
  });
  const actions = [
    `<button type="button" class="task-dir-tool" data-path-action="browse" title="${browse}" aria-label="${browse}">${pathIcon("browse")}</button>`,
    `<button type="button" class="task-dir-tool" data-path-action="create" title="${create}" aria-label="${create}">${pathIcon("new")}</button>`,
    ...editorActions,
  ].join("");
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
