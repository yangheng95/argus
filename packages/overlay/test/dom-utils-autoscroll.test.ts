import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setupAutoScroll } from "../src/utils/dom-utils";

class FakeScrollElement extends EventTarget {
  scrollHeight = 0;
  clientHeight = 0;
  dataset: Record<string, string> = {};
  private _scrollTop = 0;

  get scrollTop() {
    return this._scrollTop;
  }

  set scrollTop(value: number) {
    const maxTop = Math.max(0, this.scrollHeight - this.clientHeight);
    const next = Number.isFinite(value) ? value : 0;
    this._scrollTop = Math.max(0, Math.min(next, maxTop));
  }

}

const originalResizeObserver = globalThis.ResizeObserver;
const originalMutationObserver = globalThis.MutationObserver;
const originalRequestAnimationFrame = globalThis.requestAnimationFrame;

beforeEach(() => {
  globalThis.ResizeObserver = class {
    constructor() {
      throw new Error("setupAutoScroll must not create ResizeObserver");
    }
  } as any;
  globalThis.MutationObserver = class {
    constructor() {
      throw new Error("setupAutoScroll must not create MutationObserver");
    }
  } as any;
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  }) as any;
});

afterEach(() => {
  globalThis.ResizeObserver = originalResizeObserver;
  globalThis.MutationObserver = originalMutationObserver;
  globalThis.requestAnimationFrame = originalRequestAnimationFrame;
});

function createScrollElement() {
  const el = new FakeScrollElement();
  el.clientHeight = 100;
  el.scrollHeight = 300;
  el.scrollTop = 999;
  return el;
}

test("controller upward scroll does not disable follow lock", () => {
  const el = createScrollElement();
  let tracking = true;
  let disabled = 0;

  const ctrl = setupAutoScroll(el as any, {
    isTracking: () => tracking,
    onUserScrollUp: () => {
      tracking = false;
      disabled += 1;
    },
  });

  ctrl.scrollToTop();
  el.dispatchEvent(new Event("scroll"));

  expect(disabled).toBe(0);
  expect(tracking).toBe(true);
  ctrl.cleanup();
});

test("upward scroll away from bottom disables follow lock without intent heuristics", () => {
  const el = createScrollElement();
  let tracking = true;
  let disabled = 0;

  const ctrl = setupAutoScroll(el as any, {
    isTracking: () => tracking,
    onUserScrollUp: () => {
      tracking = false;
      disabled += 1;
    },
  });

  el.scrollTop = 140;
  el.dispatchEvent(new Event("scroll"));

  expect(disabled).toBe(1);
  expect(tracking).toBe(false);
  ctrl.cleanup();
});

test("data-driven content changes keep the view pinned to bottom while tracking", () => {
  const el = createScrollElement();

  const ctrl = setupAutoScroll(el as any, {
    isTracking: () => true,
    onUserScrollUp: () => {},
  });

  el.scrollHeight = 420;
  ctrl.contentChanged();

  expect(el.scrollTop).toBe(320);
  ctrl.cleanup();
});

test("setupAutoScroll does not construct DOM observers", () => {
  const el = createScrollElement();

  const ctrl = setupAutoScroll(el as any, {
    isTracking: () => true,
    onUserScrollUp: () => {},
  });

  ctrl.cleanup();
});

test("data-driven content changes preserve manual scroll position when tracking is disabled", () => {
  const el = createScrollElement();
  let tracking = true;

  const ctrl = setupAutoScroll(el as any, {
    isTracking: () => tracking,
    onUserScrollUp: () => {
      tracking = false;
    },
  });

  el.scrollTop = 140;
  el.dispatchEvent(new Event("scroll"));
  el.scrollHeight = 420;
  ctrl.contentChanged();

  expect(tracking).toBe(false);
  expect(el.scrollTop).toBe(140);
  ctrl.cleanup();
});

test("chat scroll keeps browser overflow anchoring enabled", () => {
  const css = readFileSync(join(import.meta.dir, "../src/styles/surfaces/conversation.css"), "utf8");
  const chatScrollRule = css.match(/\.chat-scroll\s*\{[^}]*\}/)?.[0] ?? "";
  const followLockRule = css.match(/\.chat-scroll\[data-follow-lock="true"\]\s*\{[^}]*\}/)?.[0] ?? "";
  expect(chatScrollRule).toContain("overflow-anchor: auto");
  expect(chatScrollRule).not.toContain("overflow-anchor: none");
  expect(followLockRule).toContain("overflow-anchor: none");
});

test("auto-scroll source does not reference DOM observer constructors", () => {
  const source = readFileSync(join(import.meta.dir, "../src/utils/dom-utils.ts"), "utf8");
  expect(source).not.toContain("new ResizeObserver");
  expect(source).not.toContain("new MutationObserver");
});
