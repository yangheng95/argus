import { createSignal, Show } from "solid-js";

export function ReasoningPart(props: { text: string }) {
  const [visible, setVisible] = createSignal(true);

  // Use legacy i18n label if available
  const label = () => {
    if (typeof (window as any).t === "function") {
      return (window as any).t("transcript.reasoning");
    }
    return "Reasoning";
  };

  return (
    <Show when={props.text.trim()}>
      <div class="msg-reasoning">
        <div class="reasoning-label" onClick={() => setVisible(!visible())}>
          {label()} {visible() ? "\u25BC" : "\u25B6"}
        </div>
        <Show when={visible()}>
          <div class="reasoning-text">{props.text}</div>
        </Show>
      </div>
    </Show>
  );
}
