import { Show } from "solid-js";
import { displayToolIcon, displayToolDetail, toolStatusLabel, stripAnsi } from "../utils/tool";
import { activeDirectory } from "../store/board";

export function ToolPart(props: { part: any }) {
  const state = () => props.part.state || {};
  const status = () => state().status || "pending";
  const toolName = () => props.part.tool || "unknown";
  const input = () => state().input || {};
  const icon = () => displayToolIcon(toolName());
  const statusLabel = () => toolStatusLabel(status());
  const detail = () => {
    const raw = displayToolDetail(toolName(), input(), state(), activeDirectory());
    // Suppress detail when it duplicates the tool name
    return raw && raw.toLowerCase() !== toolName().toLowerCase() ? raw : "";
  };
  const raw = () => {
    const st = state();
    const r =
      typeof st.raw === "string"
        ? typeof props.part._targetRaw === "string"
          ? props.part._targetRaw
          : st.raw
        : "";
    return r;
  };
  const output = () => stripAnsi(state().output || "");
  const error = () => stripAnsi(state().error || "") || output();

  return (
    <>
      <div class="msg-tool">
        <span class="tool-icon">{icon()}</span>
        <span class="tool-name">{toolName()}</span>
        <Show when={detail()}>
          <span class="tool-detail">{detail()}</span>
        </Show>
        <span class="tool-status" data-status={status()} title={statusLabel()}>
          {statusLabel()}
        </span>
      </div>
      <Show when={status() === "pending" && raw()}>
        <div class="msg-tool-input">{raw()}</div>
      </Show>
      <Show when={status() === "completed" && output()}>
        <div
          class="msg-tool-output"
          onClick={(e) => (e.currentTarget as HTMLElement).classList.toggle("msg-tool-output--expanded")}
        >
          {output()}
        </div>
      </Show>
      <Show when={status() === "error" && error()}>
        <div class="msg-tool-error">{error()}</div>
      </Show>
    </>
  );
}
