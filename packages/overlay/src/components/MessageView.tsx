import { For, Switch, Match, Show, createMemo } from "solid-js";
import { TextPart } from "./TextPart";
import { ToolPart } from "./ToolPart";
import { ReasoningPart } from "./ReasoningPart";

/** Use legacy orderedMessageParts if available, otherwise return parts as-is. */
function getOrderedParts(message: any): any[] {
  if (typeof (window as any).orderedMessageParts === "function") {
    return (window as any).orderedMessageParts(message);
  }
  return message.parts || [];
}

/** Use legacy roleLabel if available. */
function getRoleLabel(role: string): string {
  if (typeof (window as any).roleLabel === "function") {
    return (window as any).roleLabel(role);
  }
  if (role === "user") return "You";
  if (role === "assistant") return "Assistant";
  if (role === "system") return "System";
  return role;
}

/** Use legacy effectiveRole if available. */
function getEffectiveRole(msg: any): string {
  if (typeof (window as any).effectiveRole === "function") {
    return (window as any).effectiveRole(msg);
  }
  return msg.info?.role || "assistant";
}

/** Use legacy stamp if available. */
function formatTime(ts: number): string {
  if (typeof (window as any).stamp === "function") {
    return (window as any).stamp(ts);
  }
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString();
}

/** Use legacy shortRelativePath if available. */
function shortPath(p: string): string {
  if (typeof (window as any).shortRelativePath === "function") {
    return (window as any).shortRelativePath(p);
  }
  return p;
}

/** Use legacy escapeHtml if available. */
function escapeHtml(str: string): string {
  if (typeof (window as any).escapeHtml === "function") {
    return (window as any).escapeHtml(str);
  }
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Render a file part — images get <img>, others get filename text. */
function renderFilePart(part: any): string {
  if (typeof (window as any).renderFilePart === "function") {
    return (window as any).renderFilePart(part);
  }
  const url = part.url || part.filename || "";
  const name = part.filename || url || "file";
  const mime = part.mime || part.mediaType || "";
  const isImg =
    (mime && mime.startsWith("image/")) ||
    /^data:image\//i.test(url) ||
    /\.(png|jpe?g|gif|webp|svg|bmp|ico)(\?|$)/i.test(url);
  if (isImg && url) {
    return `<div class="msg-img-wrap"><img class="md-img" src="${escapeHtml(url)}" alt="${escapeHtml(name)}" loading="lazy"></div>`;
  }
  return `<div class="msg-text" style="font-family:var(--mono);font-size:var(--ui-font-small);color:var(--text-soft)">${escapeHtml(name)}</div>`;
}

export function MessageView(props: { message: any }) {
  const role = () => getEffectiveRole(props.message);
  const parts = () => getOrderedParts(props.message);
  const time = () => formatTime(props.message.info?.time?.created);

  // Check if this message is empty (would produce no visible output)
  const hasContent = createMemo(() => {
    const p = parts();
    if (p.length === 0) return false;
    // At least one part should produce output
    return p.some((part: any) => {
      if (part.type === "text") return !!(part.text || "").trim();
      if (part.type === "tool") return true;
      if (part.type === "reasoning") return !!(part.text || "").trim();
      if (part.type === "patch") return (part.files || []).length > 0;
      if (part.type === "file") return true;
      if (part.type === "subtask") return true;
      return false;
    });
  });

  return (
    <Show when={hasContent()}>
      <article class="turn msg" data-role={role()}>
        <div class="msg-head">
          <span class="msg-role">{getRoleLabel(role())}</span>
          <span class="msg-time">{time()}</span>
        </div>
        <div class="msg-bubble">
          <div class="msg-body">
            <For each={parts()}>
              {(part: any) => (
                <Switch fallback={null}>
                  <Match when={part.type === "text" && (part.text || "").trim()}>
                    <TextPart text={part.text || ""} />
                  </Match>
                  <Match when={part.type === "tool"}>
                    <ToolPart part={part} />
                  </Match>
                  <Match when={part.type === "reasoning" && (part.text || "").trim()}>
                    <ReasoningPart text={part.text || ""} />
                  </Match>
                  <Match when={part.type === "patch" && (part.files || []).length > 0}>
                    <div class="msg-patch">
                      {"\u2699 " + (part.files || []).map((f: string) => shortPath(f)).join(", ")}
                    </div>
                  </Match>
                  <Match when={part.type === "file"}>
                    <div innerHTML={renderFilePart(part)} />
                  </Match>
                  <Match when={part.type === "subtask"}>
                    <div class="msg-tool">
                      <span class="tool-icon">{"\u2192"}</span>
                      <span class="tool-name">Subtask</span>
                      <span class="tool-detail">{part.description || part.prompt || ""}</span>
                    </div>
                  </Match>
                </Switch>
              )}
            </For>
          </div>
        </div>
      </article>
    </Show>
  );
}
