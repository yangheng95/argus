// ── TaskDirContent / TaskWorkspaceLine ──
// Reactive replacement for renderMeta() — the directory breadcrumb +
// workspace-dir line in the task header. Previously a function in
// services/meta.ts that grabbed #taskDir / #taskWorkspaceDir via
// getElementById and wrote innerHTML / textContent / hidden / setAttribute
// every time a meta call ran. Now driven by Solid signals.
//
// The two spans live in different parents in index.html (#taskDir nests
// inside the task-cwd-dropdown shell; #taskWorkspaceDir is a sibling),
// so we render two independent Solid components mounted into the original
// slots — preserving the layout + the document-level event delegation that
// reads `data-path-action` / `data-path-set` / `data-path-open` from the
// breadcrumb buttons. IDE launchers live in WorkspaceEditorLaunchers so the
// directory control does not own editor shortcuts.
//
// pathBreadcrumb() still returns an HTML string (its buttons are clicked
// via document-level delegation in main.tsx); innerHTML on a Solid element
// is the right primitive for this trusted static markup.

import { createMemo, Show } from "solid-js";
import { boardStore } from "../store/board";
import { pathBreadcrumb } from "../utils/dom-utils";
import { activeDirectory, currentExecutionDirectory, openDirectory } from "../services/workspace";
import { t } from "../utils/i18n";

function relativePathFrom(base: string, target: string): string {
  if (!base || !target) return "";
  const norm = (s: string) => s.replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();
  const nb = norm(base);
  const nt = norm(target);
  if (nt.startsWith(nb + "/")) return target.slice(base.replace(/[\\/]+$/, "").length + 1);
  return "";
}

function shortPath(p: string): string {
  const parts = p.replace(/[\\/]+/g, "/").replace(/\/+$/, "").split("/");
  return parts.length <= 2 ? p : `…/${parts.slice(-2).join("/")}`;
}

const directoryMemo = () => activeDirectory();

export function TaskDirContent() {
  const dir = createMemo(directoryMemo);
  const breadcrumbHtml = createMemo(() => pathBreadcrumb(dir()));
  const dirTitle = createMemo(() => dir() || t("cwd.unavailable"));
  const dirEmpty = createMemo(() => (dir() ? "false" : "true"));

  return (
    <span
      class="task-dir"
      id="taskDir"
      title={dirTitle()}
      data-empty={dirEmpty()}
      innerHTML={breadcrumbHtml()}
    />
  );
}

// VcsBadge — surfaces the current branch + dirty/ahead/behind count next to
// the working directory breadcrumb. Pulls from boardStore.vcs (populated by
// services/meta.ts via GET /vcs). Renders nothing when vcs.initialized is
// false so non-git projects stay silent. The underlying signals refresh
// every time meta.ts polls so the badge tracks branch switches without
// extra wiring.
function VcsBadge() {
  const vcs = createMemo(() => boardStore.vcs as null | {
    initialized?: boolean;
    branch?: string;
    commit?: string;
    clean?: boolean;
    dirty?: boolean;
    staged?: number;
    modified?: number;
    untracked?: number;
    conflicts?: number;
    ahead?: number;
    behind?: number;
  });
  const v = createMemo(() => vcs());
  const show = createMemo(() => !!v()?.initialized && !!v()?.branch);
  const tone = createMemo(() => {
    const x = v();
    if (!x) return "neutral";
    if ((x.conflicts ?? 0) > 0) return "bad";
    if (x.dirty) return "warn";
    return "good";
  });
  const counts = createMemo(() => {
    const x = v();
    if (!x) return null;
    const parts: string[] = [];
    if ((x.staged ?? 0) > 0) parts.push(`+${x.staged}`);
    if ((x.modified ?? 0) > 0) parts.push(`~${x.modified}`);
    if ((x.untracked ?? 0) > 0) parts.push(`?${x.untracked}`);
    if ((x.conflicts ?? 0) > 0) parts.push(`!${x.conflicts}`);
    return parts.length > 0 ? parts.join(" ") : "";
  });
  const arrows = createMemo(() => {
    const x = v();
    if (!x) return "";
    const ahead = x.ahead ?? 0;
    const behind = x.behind ?? 0;
    if (ahead === 0 && behind === 0) return "";
    return `${ahead > 0 ? `↑${ahead}` : ""}${behind > 0 ? `↓${behind}` : ""}`;
  });
  const title = createMemo(() => {
    const x = v();
    if (!x) return "";
    const lines = [
      `${t("chat.git.branch")}: ${x.branch ?? "—"}`,
      x.commit ? `${t("chat.git.commit")}: ${x.commit}` : "",
      x.dirty ? `${t("vcs.dirty")}` : `${t("vcs.clean")}`,
      counts() ? counts() : "",
      arrows() ? arrows() : "",
    ].filter(Boolean);
    return lines.join("\n");
  });

  return (
    <span
      class="vcs-badge"
      data-tone={tone()}
      hidden={!show()}
      title={title()}
    >
      <span class="vcs-badge-icon" aria-hidden="true">⎇</span>
      <span class="vcs-badge-branch">{v()?.branch ?? ""}</span>
      <Show when={counts()}>
        <span class="vcs-badge-counts">{counts()}</span>
      </Show>
      <Show when={arrows()}>
        <span class="vcs-badge-arrows">{arrows()}</span>
      </Show>
    </span>
  );
}

export function TaskWorkspaceLine() {
  const dir = createMemo(directoryMemo);
  const workspaceText = createMemo(() => currentExecutionDirectory());
  const meta = createMemo(() => {
    const dirText = dir().replace(/[\\/]+$/, "");
    const wt = workspaceText();
    const same = !!dirText && !!wt && dirText.toLowerCase() === wt.toLowerCase();
    const show = !!wt && !same;
    if (!show) return { show: false, label: "", title: "" };
    const label = relativePathFrom(dirText, wt) || shortPath(wt);
    return { show: true, label: t("cwd.execution_workspace", { value: label }), title: wt };
  });

  return (
    <span class="task-workspace-row">
      <VcsBadge />
      <button
        type="button"
        class="task-workspace"
        id="taskWorkspaceDir"
        hidden={!meta().show}
        title={meta().title}
        aria-label={`${t("cwd.open")}: ${meta().title}`}
        data-ui="execution-workspace-open"
        onClick={() => void openDirectory(meta().title)}
      >
        {meta().label}
      </button>
    </span>
  );
}
