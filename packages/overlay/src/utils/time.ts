// ── Time utilities ──
// plus localeTag dependency from i18n module.

import { localeTag, t } from "./i18n";

function timeLocaleOptions(includeSeconds = true): Intl.DateTimeFormatOptions {
  return includeSeconds
    ? { hour: "2-digit", minute: "2-digit", second: "2-digit" }
    : { hour: "2-digit", minute: "2-digit" };
}

export function stamp(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString(localeTag(), timeLocaleOptions());
}

export function detailStamp(ts: number): string {
  if (!ts) return "";
  return new Date(ts).toLocaleString(localeTag(), {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return t("time.duration.hour_minute", { hours: h, minutes: m % 60 });
  if (m > 0) return t("time.duration.minute_second", { minutes: m, seconds: s % 60 });
  return t("time.duration.second", { seconds: s });
}
