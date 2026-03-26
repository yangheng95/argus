import { For, Switch, Match, Show, createMemo } from "solid-js";
import { TextPart } from "./TextPart";
import { ToolPart } from "./ToolPart";
import { ReasoningPart } from "./ReasoningPart";
import { orderedMessageParts, roleLabel, effectiveRole } from "../utils/message";
import { escapeHtml } from "../utils/markdown";
import { stamp } from "../utils/time";
import { shortRelativePath } from "../utils/tool";
import { activeDirectory, rootTaskSessionID } from "../store/board";

/** Render a file part — images get <img>, others get filename text. */
function renderFilePart(part: any): string {
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
  const role = () => effectiveRole(props.message, rootTaskSessionID());
  const parts = () => orderedMessageParts(props.message);
  const time = () => stamp(props.message.info?.time?.created);

  // Check if this message is empty (would produce no visible output)
  const hasContent = createMemo(() => {
    const p = parts();
    if (p.length === 0) return false;
    // At least one part should produce output
    return p.some((part: any) => {
      if (part.type === "text") return !!(part.text || "").trim();
      if (part.type === "tool") return true;
      if (part.type === "reasoning") return !!(part.text || "").trim();
      if (part.type === "executor_process") return !!part.process;
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
          <span class="msg-role">{roleLabel(role())}</span>
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
                    <ReasoningPart part={part} />
                  </Match>
                  <Match when={part.type === "patch" && (part.files || []).length > 0}>
                    <div class="msg-patch">
                      {"\u2699 " +
                        (part.files || [])
                          .map((f: string) => shortRelativePath(f, activeDirectory()))
                          .join(", ")}
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
                  <Match when={part.type === "executor_process" && part.process}>
                    <div
                      class="executor-process-card"
                      data-status={part.process.status || "running"}
                      data-live={part.process.status === "running" ? "true" : "false"}
                    >
                      <div class="executor-process-head">
                        <span class="executor-process-kind">
                          {String(part.process.kind || "task")}
                        </span>
                        <div class="executor-process-meta">
                          <div class="executor-process-row">
                            <div class="executor-process-title">
                              {part.process.title || part.process.id || ""}
                            </div>
                            <div
                              class="executor-process-status"
                              data-status={part.process.status || "running"}
                            >
                              {part.process.status || "running"}
                            </div>
                          </div>
                          <Show when={part.process.detail}>
                            <div class="executor-process-detail">{part.process.detail}</div>
                          </Show>
                          <Show when={part.process.progress}>
                            <div class="executor-process-progress">
                              <span class="executor-process-activity" />
                              <span>{part.process.progress}</span>
                            </div>
                          </Show>
                          <Show when={part.process.note}>
                            <div class="executor-process-note">{part.process.note}</div>
                          </Show>
                          <Show when={part.process.output}>
                            <pre class="executor-process-output">{part.process.output}</pre>
                          </Show>
                        </div>
                      </div>
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
