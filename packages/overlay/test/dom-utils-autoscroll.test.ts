import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setupAutoScroll } from "../src/utils/dom-utils";

class FakeScrollElement extends EventTarget {
  scrollHeight = 0;
  clientHeight = 0;
  children: any[] = [];
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

class FakeResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {
    resizeObservers.push(this);
  }

  observe() {}
  unobserve() {}
  disconnect() {}

  trigger(entries: ResizeObserverEntry[] = []) {
    this.callback(entries, this as any);
  }
}

class FakeMutationObserver {
  constructor(private readonly callback: MutationCallback) {
    mutationObservers.push(this);
  }

  observe() {}
  disconnect() {}

  trigger(records: MutationRecord[] = []) {
    this.callback(records, this as any);
  }
}

const resizeObservers: FakeResizeObserver[] = [];
const mutationObservers: FakeMutationObserver[] = [];

const originalResizeObserver = globalThis.ResizeObserver;
const originalMutationObserver = globalThis.MutationObserver;
const originalRequestAnimationFrame = globalThis.requestAnimationFrame;

beforeEach(() => {
  resizeObservers.length = 0;
  mutationObservers.length = 0;
  globalThis.ResizeObserver = FakeResizeObserver as any;
  globalThis.MutationObserver = FakeMutationObserver as any;
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

test("resize-driven content growth keeps the view pinned to bottom while tracking", () => {
  const el = createScrollElement();

  const ctrl = setupAutoScroll(el as any, {
    isTracking: () => true,
    onUserScrollUp: () => {},
  });

  el.scrollHeight = 420;
  resizeObservers[0]?.trigger();

  expect(el.scrollTop).toBe(320);
  ctrl.cleanup();
});

test("resize-driven content growth preserves manual scroll position when tracking is disabled", () => {
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
  resizeObservers[0]?.trigger();

  expect(tracking).toBe(false);
  expect(el.scrollTop).toBe(140);
  ctrl.cleanup();
});

test("chat scroll keeps browser overflow anchoring enabled", () => {
  const css = readFileSync(join(import.meta.dir, "../src/styles/surfaces/conversation.css"), "utf8");
  const chatScrollRule = css.match(/\.chat-scroll\s*\{[^}]*\}/)?.[0] ?? "";
  expect(chatScrollRule).toContain("overflow-anchor: auto");
  expect(chatScrollRule).not.toContain("overflow-anchor: none");
});
