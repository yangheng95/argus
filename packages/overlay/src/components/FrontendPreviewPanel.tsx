import { Show } from "solid-js";
import type { FrontendPreviewResolution } from "../services/frontend-preview";
import { t } from "../utils/i18n";
import { nativeOpen } from "../utils/native";

export function FrontendPreviewPanel(props: {
  resolution: FrontendPreviewResolution | null;
  loading: boolean;
  error: string;
  onRefresh: () => void;
}) {
  const url = () => props.resolution?.url || "";
  const status = () => {
    if (props.loading) return t("frontend_preview.loading");
    if (props.error) return props.error;
    if (!url()) return t("frontend_preview.empty");
    return props.resolution?.source === "delivery"
      ? t("frontend_preview.source.delivery")
      : t("frontend_preview.source.port_probe", { port: props.resolution?.port ?? "" });
  };

  const openExternal = async () => {
    if (!url()) return;
    try {
      await nativeOpen(url());
    } catch (err) {
      console.error("[frontend-preview] open external failed", err);
    }
  };

  return (
    <section class="frontend-preview" aria-label={t("frontend_preview.title")}>
      <div class="frontend-preview-toolbar">
        <div class="frontend-preview-url" title={url() || status()}>
          <Show when={url()} fallback={<span>{status()}</span>}>
            <span>{url()}</span>
          </Show>
        </div>
        <button
          type="button"
          class="section-icon-btn"
          title={t("frontend_preview.refresh")}
          aria-label={t("frontend_preview.refresh")}
          onClick={props.onRefresh}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M13 4.5V8h-3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M12.6 8A5 5 0 103.8 10.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
        </button>
        <button
          type="button"
          class="section-icon-btn"
          title={t("frontend_preview.open_external")}
          aria-label={t("frontend_preview.open_external")}
          disabled={!url()}
          onClick={() => void openExternal()}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M6 4h6v6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M12 4L5 11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
            <path d="M4 6v6h6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
      <Show
        when={url()}
        fallback={
          <div class="frontend-preview-empty" data-kind={props.error ? "error" : "empty"}>
            <p>{status()}</p>
          </div>
        }
      >
        <iframe
          class="frontend-preview-frame"
          src={url()}
          title={t("frontend_preview.title")}
          sandbox="allow-scripts allow-forms"
        />
      </Show>
    </section>
  );
}
