// ── FileViewPanel ──
// Workspace view that previews the current on-disk content of a single file.
// Fetches from the server's GET /file/content endpoint (File.read) and renders
// with hljs syntax highlighting via the shared markdown code-block pipeline.

import { createResource, Show } from "solid-js";
import { apiJson } from "../services/api";
import { extToLang, renderCodeBlock } from "../utils/markdown";
import { t } from "../utils/i18n";

export interface FileViewPanelProps {
  filePath: string | null;
}

type FileContent = {
  type: "text" | "binary";
  content: string;
  encoding?: "base64";
  mimeType?: string;
};

async function fetchFileContent(path: string): Promise<FileContent> {
  return (await apiJson(
    `/file/content?path=${encodeURIComponent(path)}`,
  )) as FileContent;
}

export function FileViewPanel(props: FileViewPanelProps) {
  const [file] = createResource<FileContent | null, string>(
    () => props.filePath || "",
    async (path) => {
      if (!path) return null;
      return fetchFileContent(path);
    },
  );

  const loading = () => file.loading;
  const err = () => file.error as Error | undefined;

  return (
    <div class="file-view-panel">
      <Show
        when={props.filePath}
        fallback={
          <div class="file-view-empty">
            <p class="empty-hint">{t("workspace.file_empty")}</p>
          </div>
        }
      >
        <header class="file-view-head">
          <span class="file-view-path" title={props.filePath || ""}>
            {props.filePath}
          </span>
        </header>
        <div class="file-view-body">
          <Show
            when={!loading()}
            fallback={
              <div class="file-view-empty">
                <p class="empty-hint">{t("workspace.file_loading")}</p>
              </div>
            }
          >
            <Show
              when={!err()}
              fallback={
                <div class="file-view-empty">
                  <p class="empty-hint">
                    {t("workspace.file_error", { message: err()?.message ?? "" })}
                  </p>
                </div>
              }
            >
              <Show
                when={file() && file()!.type === "text"}
                fallback={
                  <div class="file-view-empty">
                    <p class="empty-hint">{t("workspace.file_binary")}</p>
                  </div>
                }
              >
                <FileBody path={props.filePath!} content={file()!.content} />
              </Show>
            </Show>
          </Show>
        </div>
      </Show>
    </div>
  );
}

function FileBody(props: { path: string; content: string }) {
  const rendered = () => {
    const lang = extToLang(props.path);
    return renderCodeBlock(props.content, lang, Number.MAX_SAFE_INTEGER).html;
  };
  return <div class="file-view-content" innerHTML={rendered()} />;
}
