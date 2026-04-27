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
// breadcrumb buttons.
//
// pathBreadcrumb() still returns an HTML string (its buttons are clicked
// via document-level delegation in main.tsx); innerHTML on a Solid element
// is the right primitive for this trusted static markup.

import { createMemo } from "solid-js";
import { boardStore } from "../store/board";
import { settingsStore } from "../store/settings";
import { pathBreadcrumb } from "../utils/dom-utils";
import { currentExecutionDirectory } from "../services/workspace";
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

const directoryMemo = () =>
  settingsStore.directory || boardStore.board?.task?.directory || "";

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
    <span
      class="task-workspace"
      id="taskWorkspaceDir"
      hidden={!meta().show}
      title={meta().title}
    >
      {meta().label}
    </span>
  );
}
