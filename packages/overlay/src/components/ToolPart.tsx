import { Show } from "solid-js";

// Use legacy helper functions if available on window
function getToolIcon(toolName: string): string {
  if (typeof (window as any).displayToolIcon === "function") {
    return (window as any).displayToolIcon(toolName);
  }
  return "\u26A1"; // fallback: lightning bolt
}

function getToolDetail(toolName: string, input: any, st: any): string {
  if (typeof (window as any).displayToolDetail === "function") {
    return (window as any).displayToolDetail(toolName, input, st);
  }
  return "";
}

function getToolStatusLabel(status: string): string {
  if (typeof (window as any).toolStatusLabel === "function") {
    return (window as any).toolStatusLabel(status);
  }
  if (status === "completed") return "Completed";
  if (status === "running") return "Running";
  if (status === "error") return "Error";
  return "Pending";
}

function stripAnsi(str: string): string {
  if (typeof (window as any).stripAnsi === "function") {
    return (window as any).stripAnsi(str);
  }
  if (!str) return "";
  return str.replace(
    // eslint-disable-next-line no-control-regex
    /[\u001B\u009B][[\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*|[a-zA-Z\d]+(?:;[-a-zA-Z\d\/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g,
    "",
  );
}

export function ToolPart(props: { part: any }) {
  const state = () => props.part.state || {};
  const status = () => state().status || "pending";
  const toolName = () => props.part.tool || "unknown";
  const input = () => state().input || {};
  const icon = () => getToolIcon(toolName());
  const statusLabel = () => getToolStatusLabel(status());
  const detail = () => {
    const raw = getToolDetail(toolName(), input(), state());
    // Suppress detail when it duplicates the tool name
    return raw && raw.toLowerCase() !== toolName().toLowerCase() ? raw : "";
  };
  const raw = () => {
    const st = state();
    const r = typeof st.raw === "string" ? (typeof props.part._targetRaw === "string" ? props.part._targetRaw : st.raw) : "";
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
