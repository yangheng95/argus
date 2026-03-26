import { createMemo, createSignal, Show } from "solid-js";
import { reasoningPartHidden, reasoningRevision } from "../store/reasoning";
import { t } from "../utils/i18n";

export function ReasoningPart(props: { part: any }) {
  const [expanded, setExpanded] = createSignal(true);
  const text = () => String(props.part?.text || "");
  const hidden = createMemo(() => {
    reasoningRevision();
    return reasoningPartHidden(props.part);
  });

  const label = () => t("transcript.reasoning");

  return (
    <Show when={text().trim() && !hidden()}>
      <div class="msg-reasoning">
        <div class="reasoning-label" onClick={() => setExpanded(!expanded())}>
          {label()} {expanded() ? "\u25BC" : "\u25B6"}
        </div>
        <Show when={expanded()}>
          <div class="reasoning-text">{text()}</div>
        </Show>
      </div>
    </Show>
  );
}
