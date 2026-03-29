import { createEffect, onCleanup } from "solid-js";

function splitOutput(text: string): { frozenLines: string[]; activeLine: string } {
  const normalized = String(text || "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  return {
    frozenLines: lines.slice(0, -1),
    activeLine: lines.at(-1) ?? "",
  };
}

function lineText(text: string): string {
  return text.length > 0 ? text : "\u00a0";
}

export function ExecutorProcessOutput(props: { text: string }) {
  let containerRef: HTMLDivElement | undefined;
  const frozenNodes = new Map<number, HTMLDivElement>();
  let activeEl: HTMLDivElement | null = null;
  let prevFrozenCount = 0;
  let prevText = "";

  function reset(container: HTMLDivElement) {
    container.textContent = "";
    frozenNodes.clear();
    activeEl = null;
    prevFrozenCount = 0;
    prevText = "";
  }

  createEffect(() => {
    const container = containerRef;
    if (!container) return;

    const text = String(props.text || "").replace(/\r\n?/g, "\n");
    if (!text) {
      reset(container);
      return;
    }

    if (prevText && !text.startsWith(prevText)) {
      reset(container);
    }

    const { frozenLines, activeLine } = splitOutput(text);

    for (let index = prevFrozenCount; index < frozenLines.length; index += 1) {
      const node = document.createElement("div");
      node.className = "executor-process-output-line";
      node.textContent = lineText(frozenLines[index] || "");
      frozenNodes.set(index, node);
      if (activeEl && activeEl.parentNode === container) {
        container.insertBefore(node, activeEl);
      } else {
        container.appendChild(node);
      }
    }

    if (!activeEl) {
      activeEl = document.createElement("div");
      activeEl.className = "executor-process-output-line executor-process-output-line--active";
      container.appendChild(activeEl);
    }
    activeEl.textContent = lineText(activeLine);

    prevFrozenCount = frozenLines.length;
    prevText = text;
  });

  onCleanup(() => {
    frozenNodes.clear();
    activeEl = null;
    prevFrozenCount = 0;
    prevText = "";
  });

  return <div class="executor-process-output" ref={containerRef} />;
}
