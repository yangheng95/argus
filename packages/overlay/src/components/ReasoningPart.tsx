import { createMemo, createSignal, Show } from "solid-js";
import { reasoningPartHidden, reasoningRevision } from "../store/reasoning";
import { t } from "../utils/i18n";
import { renderMarkdown } from "../utils/markdown";
import { Icon } from "./Icon";

export function isEmptyReasoning(s: string): boolean {
  // Filter out reasoning that is only brackets/whitespace (e.g. "[]", "[[]]", "[] []")
  return !s.replace(/[\[\]\s]/g, "");
}

export function ReasoningPart(props: { part: any }) {
  const [expanded, setExpanded] = createSignal(false);
  const text = () => String(props.part?.text || "");
  const hidden = createMemo(() => {
    reasoningRevision();
    return reasoningPartHidden(props.part);
  });

  const label = () => t("transcript.reasoning");

  return (
    <Show when={text().trim() && !isEmptyReasoning(text()) && !hidden()}>
      <div class="msg-reasoning" data-expanded={expanded() ? "true" : "false"}>
        <button
          type="button"
          class="reasoning-label"
          aria-expanded={expanded()}
          onClick={(event) => {
            event.stopPropagation();
            setExpanded(!expanded());
          }}
        >
          {label()} <Icon name={expanded() ? "caret-down" : "chevron"} />
        </button>
        <div class="reasoning-text md-content" innerHTML={renderMarkdown(text())} />
      </div>
    </Show>
  );
}
