import { createMemo, createSignal, Show } from "solid-js"
import { reasoningPartHidden, reasoningRevision } from "../store/reasoning"
import { t } from "../utils/i18n"
import { Icon } from "./Icon"
import { StreamingMarkdownPart } from "./TextPart"
import { Button } from "./ui/Button"

export function isEmptyReasoning(s: string): boolean {
  // Filter out reasoning that is only brackets/whitespace (e.g. "[]", "[[]]", "[] []")
  return !s.replace(/[\[\]\s]/g, "")
}

export function ReasoningPart(props: { part: any; streaming?: boolean }) {
  const [expanded, setExpanded] = createSignal(true)
  const text = () => String(props.part?.text || "")
  const hidden = createMemo(() => {
    reasoningRevision()
    return reasoningPartHidden(props.part)
  })

  const label = () => t("transcript.reasoning")

  return (
    <Show when={text().trim() && !isEmptyReasoning(text()) && !hidden()}>
      <div class="msg-reasoning" data-expanded={expanded() ? "true" : "false"}>
        <Button
          type="button"
          variant="ghost"
          size="mini"
          tone="accent"
          data-ui="reasoning-toggle"
          aria-expanded={expanded()}
          onClick={(event) => {
            event.stopPropagation()
            setExpanded(!expanded())
          }}
        >
          {label()} <Icon name={expanded() ? "caret-down" : "chevron"} />
        </Button>
        <StreamingMarkdownPart
          text={text()}
          streaming={props.streaming}
          className="reasoning-text md-content"
          activeTextClassName="md-active-text reasoning-text--streaming"
        />
      </div>
    </Show>
  )
}
