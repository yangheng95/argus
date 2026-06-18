import { createMemo, Show } from "solid-js"
import type { DiffTarget } from "../services/diff"
import { t } from "../utils/i18n"
import { ChangesPanel } from "./ChangesPanel"
import { DiffPreviewPanel } from "./DiffPreviewPanel"
import { Icon } from "./Icon"
import { Button } from "./ui/Button"
import { SurfaceHeader } from "./ui/SurfaceHeader"
import { Tab, TabList, TabPanel, Tabs } from "./ui/Tabs"

export type FileChangesActiveView = "changes" | "diff"

export interface FileChangesPanelProps {
  diffOpen: boolean
  diffTarget: DiffTarget
  activeView: FileChangesActiveView
  onActiveViewChange: (view: FileChangesActiveView) => void
  onCloseDiff: () => void
}

export function FileChangesPanel(props: FileChangesPanelProps) {
  const hasDiff = createMemo(() => props.diffOpen && !!props.diffTarget?.filePath)
  const activeView = createMemo<FileChangesActiveView>(() =>
    props.activeView === "diff" && hasDiff() ? "diff" : "changes",
  )

  return (
    <section class="file-changes-panel" data-active-view={activeView()} aria-label={t("section.files")}>
      <Tabs
        class="file-changes-view-tabs-root"
        value={activeView()}
        onValueChange={(view) => props.onActiveViewChange(view as FileChangesActiveView)}
      >
        <SurfaceHeader
          variant="panel"
          title={t("section.files")}
          actions={
            <TabList size="sm" tone="neutral" data-ui="file-changes-view-tabs">
              <Tab
                value="changes"
                active={activeView() === "changes"}
                size="sm"
                tone="neutral"
                data-ui="file-changes-view-tab"
                data-value="changes"
              >
                <Icon name="file-document" size={13} />
                <span>{t("files.changes")}</span>
              </Tab>
              <Tab
                value="diff"
                active={activeView() === "diff"}
                size="sm"
                tone="neutral"
                data-ui="file-changes-view-tab"
                data-value="diff"
                disabled={!hasDiff()}
              >
                <Icon name="panel-right" size={13} />
                <span>{t("workspace.diff")}</span>
              </Tab>
            </TabList>
          }
        />
        <div class="file-changes-body">
          <TabPanel
            value="changes"
            class="file-changes-view"
            data-active={activeView() === "changes" ? "true" : "false"}
          >
            <ChangesPanel hasSelectedTask />
          </TabPanel>
          <TabPanel
            value="diff"
            class="file-changes-view file-changes-diff"
            data-active={activeView() === "diff" ? "true" : "false"}
          >
            <Show
              when={hasDiff()}
              fallback={
                <div class="file-editor-empty">
                  <Icon name="file-document" size={18} />
                  <p>{t("diff.select_file")}</p>
                </div>
              }
            >
              <header class="file-changes-diff-header">
                <span>{t("workspace.diff")}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  tone="neutral"
                  data-ui="file-changes-diff-close"
                  title={t("workspace.close")}
                  aria-label={t("workspace.close")}
                  onClick={props.onCloseDiff}
                >
                  <Icon name="close" size={13} />
                </Button>
              </header>
              <DiffPreviewPanel target={props.diffTarget} />
            </Show>
          </TabPanel>
        </div>
      </Tabs>
    </section>
  )
}
