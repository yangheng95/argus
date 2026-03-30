import { Index, Switch, Match, Show, createMemo, createSignal } from "solid-js";
import { TextPart, StaticTextPart } from "./TextPart";
import { ToolPart } from "./ToolPart";
import { ReasoningPart, isEmptyReasoning } from "./ReasoningPart";
import { ExecutorGoalBlock } from "./ExecutorGoalBlock";
import { orderedMessageParts, roleLabel, effectiveRole } from "../utils/message";
import { escapeHtml } from "../utils/markdown";
import { stamp } from "../utils/time";
import { shortRelativePath } from "../utils/tool";
import { activeDirectory, rootTaskSessionID, goalSessionIDs } from "../store/board";
import { t } from "../utils/i18n";

/** Long synthetic messages (spec, plan) are collapsed by default. */
const COLLAPSIBLE_ROLES = new Set(["spec", "planner"]);
const COLLAPSE_THRESHOLD = 300; // chars

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
  const role = () => effectiveRole(props.message, rootTaskSessionID(), goalSessionIDs());
  const parts = () => orderedMessageParts(props.message);
  const time = () => stamp(props.message.info?.time?.created);

  const executorType = createMemo(() => {
    if (role() !== "executor") return undefined;
    const p = parts();
    return p.length > 0 && p.every((part: any) => part.type === "executor_process")
      ? "process"
      : "events";
  });

 // Check if this message is empty (would produce no visible output)
  const hasContent = createMemo(() => {
    const p = parts();
    if (p.length === 0) return false;
 // At least one part should produce output
    return p.some((part: any) => {
      if (part.type === "text") return !!(part.text || "").trim();
      if (part.type === "tool") return true;
      if (part.type === "reasoning") return !!(part.text || "").trim() && !isEmptyReasoning(part.text || "");
      if (part.type === "executor_process") return !!part.process;
      if (part.type === "patch") return (part.files || []).length > 0;
      if (part.type === "file") return true;
      if (part.type === "subtask") return true;
      return false;
    });
  });

  const goalRunID = () => props.message?.info?.goalRunID;
  const goalTitle = () => props.message?.info?.goalTitle;
  const isExecutorProcess = () => executorType() === "process";

  // Collapsible long messages (spec, plan)
  const isCollapsible = () => {
    if (!props.message?._synthetic) return false;
    if (!COLLAPSIBLE_ROLES.has(role())) return false;
    const totalText = parts().reduce((acc: number, p: any) => acc + (p.text || "").length, 0);
    return totalText > COLLAPSE_THRESHOLD;
  };
  const [collapsed, setCollapsed] = createSignal(true);
  const collapsedSummary = createMemo(() => {
    if (!isCollapsible()) return "";
    const fullText = parts().map((p: any) => p.text || "").join("\n");
    // Take first line or first 200 chars as summary
    const firstLine = fullText.split("\n").find((l: string) => l.trim()) || "";
    return firstLine.length > 200 ? firstLine.slice(0, 200) + "..." : firstLine;
  });

  const executorProcesses = createMemo(() => {
    if (!isExecutorProcess()) return [];
    return parts().map((p: any) => p.process).filter(Boolean);
  });

  return (
    <Show when={hasContent()}>
      <Show
        when={isExecutorProcess()}
        fallback={
          <article
            class="turn msg"
            data-role={role()}
            data-executor-type={executorType()}
          >
            <div class="msg-head">
              <span class="msg-role">{roleLabel(role())}</span>
              <span class="msg-time">{time()}</span>
            </div>
            <div class="msg-bubble">
              <Show when={isCollapsible() && collapsed()}>
                <div class="msg-body msg-collapsed">
                  <StaticTextPart text={collapsedSummary()} />
                  <button class="btn mini" style="margin-top: 4px; font-size: 11px;" onClick={() => setCollapsed(false)}>
                    {t("common.expand") || "Expand"} ▼
                  </button>
                </div>
              </Show>
              <Show when={!isCollapsible() || !collapsed()}>
              <div class="msg-body">
                <Show when={isCollapsible()}>
                  <button class="btn mini" style="margin-bottom: 4px; font-size: 11px;" onClick={() => setCollapsed(true)}>
                    {t("common.collapse") || "Collapse"} ▲
                  </button>
                </Show>
                <Index each={parts()}>
                  {(part) => (
                    <Switch fallback={null}>
                      <Match when={part().type === "text" && (part().text || "").trim()}>
                        <TextPart text={part().text || ""} />
                      </Match>
                      <Match when={part().type === "tool"}>
                        <ToolPart part={part()} />
                      </Match>
                      <Match when={part().type === "reasoning" && (part().text || "").trim() && !isEmptyReasoning(part().text || "")}>
                        <ReasoningPart part={part()} />
                      </Match>
                      <Match when={part().type === "patch" && (part().files || []).length > 0}>
                        <div class="msg-patch">
                          {"\u2699 " +
                            (part().files || [])
                              .map((f: string) => shortRelativePath(f, activeDirectory()))
                              .join(", ")}
                        </div>
                      </Match>
                      <Match when={part().type === "file"}>
                        <div innerHTML={renderFilePart(part())} />
                      </Match>
                      <Match when={part().type === "subtask"}>
                        <div class="msg-tool">
                          <span class="tool-icon">{"\u2192"}</span>
                          <span class="tool-name">Subtask</span>
                          <span class="tool-detail">{part().description || part().prompt || ""}</span>
                        </div>
                      </Match>
                    </Switch>
                  )}
                </Index>
              </div>
              </Show>
            </div>
          </article>
        }
      >
        <article class="turn msg" data-role={role()} data-executor-type="process">
          <ExecutorGoalBlock
            processes={executorProcesses()}
            goalRunID={goalRunID()}
            goalTitle={goalTitle()}
          />
        </article>
      </Show>
    </Show>
  );
}
