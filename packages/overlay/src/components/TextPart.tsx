/** @jsxImportSource solid-js */
import { createMemo, For, Show } from "solid-js"
import { renderMarkdown } from "../utils/markdown"
import { createStreamingTextPartModel } from "./text-part-model"

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

export function TextPart(props: { text: string; streaming?: boolean }) {
  const { frozenHtml, activeText } = createStreamingTextPartModel(props, renderMarkdown)

  return (
    <div class="msg-text">
      <For each={frozenHtml()}>{(html) => <div class="md-frozen-block" innerHTML={html} />}</For>
      <Show when={activeText()}>
        <div class="md-active-text">{activeText()}</div>
      </Show>
    </div>
  )
}

/**
 * Non-streaming variant: renders the full text as markdown in one pass.
 * Used for static content that will never receive incremental updates
 * (e.g. board spec panel, loaded transcript messages).
 */
export function StaticTextPart(props: { text: string }) {
  const html = createMemo(() => renderMarkdown(props.text))
  return <div class="msg-text" innerHTML={html()} />
}
