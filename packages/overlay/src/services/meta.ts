// ── Meta Service ──
// TypeScript port of meta/changes functions
// loadMeta, loadChanges, normalizeDiffs, diffStatus, openDiffDialog.

import { appStore, setAppStore } from "../store/app";
import { boardStore, setPath, setVcs } from "../store/board";
import { settingsStore } from "../store/settings";
import { pathBreadcrumb } from "../utils/dom-utils";
import { t } from "../utils/i18n";
import { AppLog } from "../utils/log";
import { apiJson } from "./api";
import { setWorkspaceDirectory } from "./workspace";

// ── Types ──

export type DiffStatus = "added" | "deleted" | "modified";

export interface DiffItem {
  file: string;
  before: string;
  after: string;
  additions: number;
  deletions: number;
  status: DiffStatus;
}

// ── loadMeta ──

/**
 * Fetches the current working path and VCS info from the server and updates
 * the app store.
 * Mirrors loadMeta. Calls renderMeta() in the finally-block to
 * keep the DOM in sync regardless of success or failure.
 */
export async function loadMeta(): Promise<void> {
  const epoch = settingsStore.directoryEpoch;
  try {
    const [path, vcs] = await Promise.all([
      apiJson("path"),
      apiJson("vcs"),
    ]);
    if (epoch !== settingsStore.directoryEpoch) return;
    const directory =
      path && typeof path.directory === "string"
        ? path.directory.trim()
        : "";
    setPath(directory ? { directory } : null);
    if (!settingsStore.directory && directory) {
      setWorkspaceDirectory(directory, "auto");
    }
    setVcs(vcs ?? null);
    setAppStore("config", (prev: any) => ({
      ...(prev ?? {}),
      _metaPath: directory ? { directory } : null,
      _metaVcs: vcs ?? null,
    }));
  } catch (e) {
    AppLog.debug("meta", "loadMeta failed, resetting path/vcs", {
      error: String(e),
    });
    if (epoch !== settingsStore.directoryEpoch) return;
    setPath(null);
    setVcs(null);
    setAppStore("config", (prev: any) => ({
      ...(prev ?? {}),
      _metaPath: null,
      _metaVcs: null,
    }));
  } finally {
    renderMeta();
  }
}

// ── renderMeta (DOM) ──

/**
 * Imperatively updates the meta DOM nodes (directory breadcrumb, workspace dir,
 * git branch) from the current store state.
 * .ts — still needed by loadMeta's finally-block and the
 * 's directory setter.
 */
/**
 * Build a concise git status label: branch · +ahead -behind · staged/modified/untracked · clean
 */
function gitLabel(vcs: any, dir: string): string {
  if (!dir) return t("git.unavailable");
  if (vcs === null || vcs === undefined) return t("git.unavailable");
  if (!vcs.branch) return t("git.init");
  const parts: string[] = [vcs.branch];
  if (vcs.ahead) parts.push(`+${vcs.ahead}`);
  if (vcs.behind) parts.push(`-${vcs.behind}`);
  if (vcs.conflicts) parts.push(t("git.conflicts", { count: vcs.conflicts }));
  if (vcs.dirty) {
    const changes: string[] = [];
    if (vcs.staged) changes.push(t("git.staged", { count: vcs.staged }));
    if (vcs.modified) changes.push(t("git.modified", { count: vcs.modified }));
    if (vcs.untracked) changes.push(t("git.untracked", { count: vcs.untracked }));
    parts.push(changes.join(" "));
  } else {
    parts.push(t("git.clean"));
  }
  return parts.filter(Boolean).join(" · ");
}

/**
 * Build a multi-line git tooltip with all status details.
 */
function gitTitle(vcs: any, dir: string): string {
  if (!dir) return "";
  if (vcs === null || vcs === undefined) return "";
  if (!vcs.branch) return t("git.init_title");
  return [
    t("git.branch", { value: vcs.branch }),
    t("git.clean_title", { value: vcs.clean ? t("common.yes") : t("common.no") }),
    t("git.staged", { count: vcs.staged ?? 0 }),
    t("git.modified", { count: vcs.modified ?? 0 }),
    t("git.untracked", { count: vcs.untracked ?? 0 }),
    t("git.conflicts", { count: vcs.conflicts ?? 0 }),
    t("git.ahead", { count: vcs.ahead ?? 0 }),
    t("git.behind", { count: vcs.behind ?? 0 }),
  ].join("\n");
}

function canInitGit(): boolean {
  const vcs = boardStore.vcs;
  if (vcs === null || vcs === undefined) return false;
  return !!settingsStore.directory && !vcs.branch;
}

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

export function renderMeta(): void {
  const dirNode = document.getElementById("taskDir");
  const workspaceNode = document.getElementById("taskWorkspaceDir");
  const gitNode = document.getElementById("taskGit");
  const dir = settingsStore.directory || boardStore.board?.task?.directory || "";
  const vcs = boardStore.vcs;

  if (dirNode) {
    dirNode.innerHTML = pathBreadcrumb(dir);
    dirNode.setAttribute("title", dir || t("cwd.unavailable"));
    (dirNode as HTMLElement).dataset.empty = dir ? "false" : "true";
    const path = dirNode.querySelector(".task-dir-path");
    if (path instanceof HTMLElement) path.scrollLeft = path.scrollWidth;
  }

  if (workspaceNode) {
    const executionDir =
      Array.isArray((boardStore.board as any)?.goalRuns) &&
      (boardStore.board as any).goalRuns.find((item: any) => item?.workspaceDir)?.workspaceDir;
    const workspaceText = typeof executionDir === "string" ? executionDir.trim() : "";
    const dirText = dir.replace(/[\\/]+$/, "");
    const same = !!dirText && !!workspaceText && dirText.toLowerCase() === workspaceText.toLowerCase();
    const show = !!workspaceText && !same;
    const label = relativePathFrom(dirText, workspaceText) || shortPath(workspaceText);
    workspaceNode.textContent = show ? t("cwd.execution_workspace", { value: label }) : "";
    workspaceNode.setAttribute("title", show ? workspaceText : "");
    (workspaceNode as HTMLElement).hidden = !show;
  }

  if (gitNode) {
    const actionable = canInitGit();
    gitNode.textContent = gitLabel(vcs, dir);
    gitNode.setAttribute("title", gitTitle(vcs, dir));
    (gitNode as HTMLElement).dataset.state = actionable ? "action" : vcs?.dirty ? "dirty" : vcs?.clean ? "clean" : "idle";
    (gitNode as HTMLElement).dataset.actionable = String(actionable);
    gitNode.toggleAttribute("disabled", !actionable && !vcs?.branch);
  }
}

// ── Diff helpers ──

/**
 * Normalises a raw diff list from the server into a consistent DiffItem array,
 * sorted by filename.
 * Mirrors normalizeDiffs.
 */
export function normalizeDiffs(list: any[]): DiffItem[] {
  return (Array.isArray(list) ? list : [])
    .filter((item) => item && typeof item.file === "string")
    .map((item) => ({
      file: String(item.file || "").replace(/^[ab]\//, ""),
      before: typeof item.before === "string" ? item.before : "",
      after: typeof item.after === "string" ? item.after : "",
      additions: Number.isFinite(Number(item.additions))
        ? Number(item.additions)
        : 0,
      deletions: Number.isFinite(Number(item.deletions))
        ? Number(item.deletions)
        : 0,
      status: diffStatus(item),
    }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Derives the diff status for a single raw diff item.
 * Mirrors diffStatus.
 */
export function diffStatus(item: any): DiffStatus {
  if (
    item.status === "added" ||
    item.status === "deleted" ||
    item.status === "modified"
  ) {
    return item.status as DiffStatus;
  }
  if (!item.before && item.after) return "added";
  if (item.before && !item.after) return "deleted";
  return "modified";
}

// ── loadChanges ──

/**
 * Derives the current changes from the board store's delivery result diffs and
 * returns the normalised DiffItem list.
 * NOTE: The original loadChanges.changes and called
 * renderChanges(). This function returns the data instead, so callers can
 * update their own Solid signals/stores.
 * Mirrors loadChanges.
 */
export function deriveChanges(): DiffItem[] {
  if (!boardStore.selectedTaskID) return [];
  const board = boardStore.board as any;
  const delivery =
    board?.acceptedDelivery?.result?.diffs ||
    board?.delivery?.result?.diffs ||
    board?.candidateDelivery?.result?.diffs ||
    [];
  return normalizeDiffs(delivery);
}
