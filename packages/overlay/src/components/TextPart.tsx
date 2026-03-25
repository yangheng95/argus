import { createMemo } from "solid-js";

// Use the legacy renderMarkdown if available, otherwise escape HTML
function renderMarkdown(text: string): string {
  if (typeof (window as any).renderMarkdown === "function") {
    return (window as any).renderMarkdown(text);
  }
  // Fallback: escape HTML
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

export function TextPart(props: { text: string }) {
  const html = createMemo(() => renderMarkdown(props.text));

  return <div class="msg-text" innerHTML={html()} />;
}
