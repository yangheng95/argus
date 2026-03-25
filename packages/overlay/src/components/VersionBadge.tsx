// ── VersionBadge Component ──
// Solid.js port of renderVersions from app.js.
// Renders the channel summary badge in the titlebar's brand area, including
// a tooltip card listing configured / partial / missing / disabled channels.

import { createMemo, For, Show } from "solid-js";
import { t } from "../utils/i18n";

// ── Overlay constants (mirrors app.js) ──

const OVERLAY_VERSION = "0.0.1-alpha";
const OVERLAY_AUTHOR_URL = "https://github.com/yangheng95";

// ── Types ──

export interface ChannelInfo {
  name: string;
  status: "configured" | "partial" | "missing" | "disabled";
}

// ── VersionBadge ──

export interface VersionBadgeProps {
  /** Core server version string (empty string if unknown). */
  coreVersion: string;
  /** Channels list loaded from the API. */
  channels: ChannelInfo[];
  /** Called when the user clicks the badge to open the channel settings dialog. */
  onOpenChannels: () => void;
}

export function VersionBadge(props: VersionBadgeProps) {
  // Version text (shown in the chat footer / about — mirrors renderVersions)
  const versionText = createMemo(() => {
    const parts = [t("version.overlay", { version: OVERLAY_VERSION })];
    parts.push(
      props.coreVersion
        ? t("version.core", { version: props.coreVersion })
        : t("version.core_unknown"),
    );
    return parts.join(" / ");
  });

  // Channel groupings
  const configured = createMemo(() =>
    props.channels.filter((c) => c.status === "configured"),
  );
  const partial = createMemo(() =>
    props.channels.filter((c) => c.status === "partial"),
  );
  const missing = createMemo(() =>
    props.channels.filter((c) => c.status === "missing"),
  );
  const disabled = createMemo(() =>
    props.channels.filter((c) => c.status === "disabled"),
  );

  // Summary label shown on the badge
  const summary = createMemo(() => {
    const cfg = configured();
    if (cfg.length === 0) return t("channel.setup_needed");
    if (cfg.length === 1) return cfg[0].name;
    return t("channel.summary_plus", {
      name: cfg[0].name,
      count: cfg.length - 1,
    });
  });

  // Tooltip / aria hint combining all detail lines
  const hint = createMemo(() => {
    const lines: string[] = [];
    if (configured().length > 0)
      lines.push(
        t("channel.configured", {
          names: configured()
            .map((c) => c.name)
            .join(", "),
        }),
      );
    else lines.push(t("channel.configured_none"));
    if (partial().length > 0)
      lines.push(
        t("channel.needs_setup", {
          names: partial()
            .map((c) => c.name)
            .join(", "),
        }),
      );
    if (missing().length > 0)
      lines.push(
        t("channel.available", {
          names: missing()
            .map((c) => c.name)
            .join(", "),
        }),
      );
    if (disabled().length > 0)
      lines.push(
        t("channel.disabled", {
          names: disabled()
            .map((c) => c.name)
            .join(", "),
        }),
      );
    lines.push(t("channel.open_settings"));
    return lines.join(" | ");
  });

  // Tone on the summary span
  const summaryClass = createMemo(() =>
    configured().length > 0
      ? "brand-channel brand-channel-summary"
      : "brand-channel brand-channel-summary brand-channel-empty",
  );

  // Tooltip card rows
  interface TipRow {
    tone: string;
    text: string;
  }
  const tipRows = createMemo<TipRow[]>(() => {
    const rows: TipRow[] = [];
    if (configured().length > 0)
      rows.push({
        tone: "configured",
        text: t("channel.configured", {
          names: configured()
            .map((c) => c.name)
            .join(", "),
        }),
      });
    else
      rows.push({ tone: "configured", text: t("channel.configured_none") });
    if (partial().length > 0)
      rows.push({
        tone: "partial",
        text: t("channel.needs_setup", {
          names: partial()
            .map((c) => c.name)
            .join(", "),
        }),
      });
    if (missing().length > 0)
      rows.push({
        tone: "missing",
        text: t("channel.available", {
          names: missing()
            .map((c) => c.name)
            .join(", "),
        }),
      });
    if (disabled().length > 0)
      rows.push({
        tone: "disabled",
        text: t("channel.disabled", {
          names: disabled()
            .map((c) => c.name)
            .join(", "),
        }),
      });
    return rows.filter((r) => r.text);
  });

  return (
    <div class="brand-version">
      {/* Version string (hidden visually, consumed by tooltip / about panel) */}
      <span class="brand-version-text" title={versionText()} aria-hidden="true">
        {versionText()}
      </span>

      {/* Channel summary badge with tooltip */}
      <button
        type="button"
        class="brand-channel-group"
        data-no-drag="true"
        data-open-channels="true"
        title={hint()}
        aria-label={hint()}
        onClick={props.onOpenChannels}
      >
        <span class="brand-channel-label">{t("channel.channels")}</span>
        <span class={summaryClass()}>{summary()}</span>

        {/* Tooltip card (pure CSS hover) */}
        <span class="brand-channel-tip" aria-hidden="true">
          <span class="brand-channel-tip-title">
            {t("channel.channels")}
          </span>
          <For each={tipRows()}>
            {(row) => (
              <span
                class="brand-channel-tip-row"
                data-tone={row.tone}
              >
                {row.text}
              </span>
            )}
          </For>
          <span class="brand-channel-tip-footer">
            {t("channel.open_settings")}
          </span>
        </span>
      </button>

      {/* Author link */}
      <a
        class="brand-author"
        href={OVERLAY_AUTHOR_URL}
        target="_blank"
        rel="noopener noreferrer"
        title={t("version.author")}
      >
        {t("version.author")}
      </a>
    </div>
  );
}
