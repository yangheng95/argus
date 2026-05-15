import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { renderMarkdown } from "../utils/markdown";

/**
 * Incremental streaming markdown renderer.
 * Splits text at double-newline block boundaries. Completed blocks are
 * rendered once and frozen — their DOM is never touched again. While the
 * owning card is running, the trailing "active" block is shown as raw text
 * so every delta is visible immediately without synchronous markdown parsing.
 *
 * Result: streaming deltas write text nodes only; markdown parsing happens
 * once for completed blocks and once for the final active block when the
 * card leaves the running state.
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

export function TextPart(props: { text: string; streaming?: boolean }) {
  // Frozen block cache: index → rendered HTML string.
  // Once a block is frozen its HTML never changes.
  const [frozenHtml, setFrozenHtml] = createSignal<string[]>([]);
  let frozenSources: string[] = [];
  const [activeText, setActiveText] = createSignal("");

  createEffect(() => {
    const text = props.text || "";
    const streaming = props.streaming === true;
    const blocks = splitBlocks(text);
    const total = blocks.length;
    // Running streams keep the trailing block raw; completed text renders every
    // block as markdown exactly once through the frozen cache.
    const frozenCount = streaming ? Math.max(0, total - 1) : total;
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

    setActiveText(streaming && total > 0 ? blocks[total - 1] : "");
  });

  return (
    <div class="msg-text">
      <For each={frozenHtml()}>
        {(html) => <div class="md-frozen-block" innerHTML={html} />}
      </For>
      <Show when={activeText()}>
        <div class="md-active-text">{activeText()}</div>
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
