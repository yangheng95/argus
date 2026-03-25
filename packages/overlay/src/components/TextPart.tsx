import { createMemo } from "solid-js";
import { renderMarkdown } from "../utils/markdown";

export function TextPart(props: { text: string }) {
  const html = createMemo(() => renderMarkdown(props.text));

  return <div class="msg-text" innerHTML={html()} />;
}
