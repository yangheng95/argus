import { Show } from "solid-js";
import type { FrontendPreviewResolution } from "../services/frontend-preview";
import { t } from "../utils/i18n";
import { Icon } from "./Icon";
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
          <Icon name="refresh" size={13} />
        </button>
        <button
          type="button"
          class="section-icon-btn"
          title={t("frontend_preview.open_external")}
          aria-label={t("frontend_preview.open_external")}
          disabled={!url()}
          onClick={() => void openExternal()}
        >
          <Icon name="external-link" size={13} />
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
