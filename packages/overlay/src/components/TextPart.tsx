import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { renderMarkdown } from "../utils/markdown";

/**
 * Incremental streaming markdown renderer.
 * Splits text at double-newline block boundaries. Completed blocks are
 * rendered once and frozen — their DOM is never touched again. Only the
 * trailing "active" block (the one still receiving deltas) is re-rendered
 * on each update, throttled to one render per animation frame via rAF.
 *
 * Result: for a 500-line response, each delta only re-parses the last
 * paragraph (~few lines) instead of the entire document — and during
 * high-frequency streaming the render is coalesced to at most once per
 * vsync frame, keeping the JS main thread free for input events.
 */

/** Split text into top-level markdown blocks separated by blank lines. */
function splitBlocks(text: string): string[] {
  if (!text) return [];
  // Split on double newline (standard markdown block boundary).
  // Preserve code fences as single blocks even if they contain blank lines.
  const blocks: string[] = [];
  let current = "";
  let inFence = false;

  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      current += (current ? "\n" : "") + line;
      continue;
    }
    if (inFence) {
      current += (current ? "\n" : "") + line;
      continue;
    }
    // Blank line outside of fence → block boundary
    if (line.trim() === "") {
      if (current.trim()) {
        blocks.push(current);
      }
      current = "";
      continue;
    }
    current += (current ? "\n" : "") + line;
  }
  if (current) blocks.push(current);
  return blocks;
}

export function TextPart(props: { text: string }) {
  // Frozen block cache: index → rendered HTML string.
  // Once a block is frozen its HTML never changes.
  const [frozenHtml, setFrozenHtml] = createSignal<string[]>([]);
  let frozenSources: string[] = [];

  // rAF throttle state — coalesce rapid text deltas into one signal write per frame.
  let pendingRAF = 0;
  let pendingActiveText = "";
  const [activeText, setActiveText] = createSignal("");

  function commitActiveText() {
    pendingRAF = 0;
    setActiveText(pendingActiveText);
  }

  const activeHtml = createMemo(() => {
    const text = activeText();
    if (!text) return "";
    const t0 = performance.now();
    const html = renderMarkdown(text);
    const dt = performance.now() - t0;
    if (dt > 8) {
      console.warn(
        `[perf] TextPart renderMarkdown: ${dt.toFixed(1)}ms, block ${text.length} chars`,
      );
    }
    return html;
  });

  createEffect(() => {
    const text = props.text || "";
    const blocks = splitBlocks(text);
    const total = blocks.length;
    // All blocks except the last are "complete" (frozen).
    const frozenCount = Math.max(0, total - 1);
    const nextFrozenSources = blocks.slice(0, frozenCount);

    const cacheStillValid =
      frozenSources.length <= nextFrozenSources.length &&
      frozenSources.every((source, index) => source === nextFrozenSources[index]);
    if (!cacheStillValid) {
      frozenSources = nextFrozenSources;
      setFrozenHtml(nextFrozenSources.map((source) => renderMarkdown(source)));
    } else if (nextFrozenSources.length > frozenSources.length) {
      const additions = nextFrozenSources
        .slice(frozenSources.length)
        .map((source) => renderMarkdown(source));
      frozenSources = nextFrozenSources;
      setFrozenHtml((prev) => [...prev, ...additions]);
    }

    // 2. Update the active (trailing) block via rAF throttle.
    //    During high-frequency streaming (register_goal, large tool output)
    //    Solid fires this effect on every text delta — potentially 20+/s from
    //    the 50ms SSE flush interval. Deferring the signal write to rAF
    //    coalesces multiple deltas into a single sanitized markdown render
    //    per vsync frame while keeping DOM ownership inside Solid.
    pendingActiveText = total > 0 ? blocks[total - 1] : "";
    if (!pendingRAF) pendingRAF = requestAnimationFrame(commitActiveText);
  });

  onCleanup(() => {
    if (pendingRAF) cancelAnimationFrame(pendingRAF);
    pendingRAF = 0;
    frozenSources = [];
  });

  return (
    <div class="msg-text">
      <For each={frozenHtml()}>
        {(html) => <div class="md-frozen-block" innerHTML={html} />}
      </For>
      <Show when={activeText()}>
        <div class="md-active-block" innerHTML={activeHtml()} />
      </Show>
    </div>
  );
}

/**
 * Non-streaming variant: renders the full text as markdown in one pass.
 * Used for static content that will never receive incremental updates
 * (e.g. board spec panel, loaded transcript messages).
 */
export function StaticTextPart(props: { text: string }) {
  const html = createMemo(() => renderMarkdown(props.text));
  return <div class="msg-text" innerHTML={html()} />;
}
