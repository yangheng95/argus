import { createEffect, createMemo, onCleanup } from "solid-js";
import { renderMarkdown } from "../utils/markdown";

/**
 * Incremental streaming markdown renderer.
 * Splits text at double-newline block boundaries. Completed blocks are
 * rendered once and frozen — their DOM is never touched again. Only the
 * trailing "active" block (the one still receiving deltas) is re-rendered
 * on each update.
 * Result: for a 500-line response, each delta only re-parses the last
 * paragraph (~few lines) instead of the entire document.
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
  let containerRef: HTMLDivElement | undefined;

 // Frozen block cache: index → rendered HTML string.
 // Once a block is frozen its HTML never changes.
  const frozen = new Map<number, string>();
 // DOM nodes for frozen blocks — kept alive, never re-created.
  const frozenNodes = new Map<number, HTMLElement>();
  let prevBlockCount = 0;
  let activeEl: HTMLElement | null = null;

  createEffect(() => {
    const text = props.text || "";
    const container = containerRef;
    if (!container) return;

    const blocks = splitBlocks(text);
    const total = blocks.length;
 // All blocks except the last are "complete" (frozen).
 // When text is finalized (no more deltas) the last block also gets frozen
 // on the NEXT effect run when nothing changes — but that's fine because
 // the active block is always small.
    const frozenCount = Math.max(0, total - 1);

 // 1. Freeze newly completed blocks — render once, cache forever
    for (let i = prevBlockCount; i < frozenCount; i++) {
      if (!frozen.has(i)) {
        const html = renderMarkdown(blocks[i]);
        frozen.set(i, html);
        const node = document.createElement("div");
        node.className = "md-frozen-block";
        node.innerHTML = html;
        frozenNodes.set(i, node);
 // Insert before the active element (or append)
        if (activeEl && activeEl.parentNode === container) {
          container.insertBefore(node, activeEl);
        } else {
          container.appendChild(node);
        }
      }
    }

 // 2. Update the active (trailing) block — this is the only innerHTML churn
    if (total > 0) {
      const activeText = blocks[total - 1];
      if (!activeEl) {
        activeEl = document.createElement("div");
        activeEl.className = "md-active-block";
        container.appendChild(activeEl);
      }
      activeEl.innerHTML = renderMarkdown(activeText);
    } else if (activeEl) {
      activeEl.innerHTML = "";
    }

    prevBlockCount = frozenCount;
  });

  onCleanup(() => {
    frozen.clear();
    frozenNodes.clear();
    activeEl = null;
    prevBlockCount = 0;
  });

  return <div class="msg-text" ref={containerRef} />;
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
