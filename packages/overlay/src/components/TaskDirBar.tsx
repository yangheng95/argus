// ── TaskDirBar ──
// Solid components for the task-bar project cluster. The cwd dropdown owns
// only the breadcrumb + path actions; the git branch badge is a separate
// sibling surface because it reflects workspace state rather than being a
// cwd-selection control. Both render into dedicated mounts in index.html.
//
// IDE launchers live in WorkspaceEditorLaunchers so this module does not
// own editor shortcuts. Per-goal worktree display lives in
// GoalWorkflowGroup (right-side goal panel); see
// specs/new-arch/2026-05-11-goal-worktree-display.md for the rationale on
// why worktree is a per-goal surface, not a task-header one.

import { createMemo, Show } from "solid-js";
import { boardStore } from "../store/board";
import { pathBreadcrumb } from "../utils/dom-utils";
import { activeDirectory } from "../services/workspace";
import { t } from "../utils/i18n";

const directoryMemo = () => activeDirectory();

export function TaskDirContent() {
  const dir = createMemo(directoryMemo);
  const breadcrumbHtml = createMemo(() => pathBreadcrumb(dir()));
  const dirTitle = createMemo(() => dir() || t("cwd.unavailable"));
  const dirEmpty = createMemo(() => (dir() ? "false" : "true"));

  return (
    <>
      <span
        class="task-dir"
        id="taskDir"
        title={dirTitle()}
        data-empty={dirEmpty()}
        innerHTML={breadcrumbHtml()}
      />
      <VcsBadge />
    </>
  );
}

// VcsBadge — surfaces the current branch + dirty/ahead/behind count next to
// the cwd dropdown. Pulls from boardStore.vcs (populated by services/meta.ts
// via GET /vcs). Renders nothing when vcs.initialized is false so non-git
// projects stay silent. The underlying signals refresh every time meta.ts
// polls so the badge tracks branch switches without extra wiring.
export function VcsBadge() {
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
