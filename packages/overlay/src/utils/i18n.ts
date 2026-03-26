// ── i18n module ──
// sanitizeLocale, record, localeValue, fillTemplate, t, tc, localeTag.
// Extends with loadLocale / setLocale / getLocale for module-level usage.

import { appStore, setLocaleState, setI18nReady } from "../store/app";

const SUPPORTED_LOCALES = ["zh-CN", "en-US"];

// Module-level state (
let messages: Record<string, any> = {};
let currentLocale: string = sanitizeLocale(
  (typeof document !== "undefined" ? document.documentElement.lang : "") ||
    (typeof navigator !== "undefined" ? navigator.language : "") ||
    "en-US",
);

// ── Helpers ──

function record(value: any): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function sanitizeLocale(value: string): string {
  const text = String(value || "").trim();
  if (SUPPORTED_LOCALES.includes(text)) return text;
  if (/^zh\b/i.test(text)) return "zh-CN";
  return "en-US";
}

function localeValue(key: string, locale: string = currentLocale): any {
  appStore.localeSeq;
  const source = messages[locale];
  if (record(source) && Object.hasOwn(source, key)) return (source as Record<string, any>)[key];
  return key
    .split(".")
    .reduce((acc: any, part: string) => (record(acc) ? (acc as Record<string, any>)[part] : undefined), source);
}

export function fillTemplate(text: string, vars: Record<string, any> = {}): string {
  return String(text).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const value = key
      .split(".")
      .reduce(
        (acc: any, part: string) => (record(acc) ? (acc as Record<string, any>)[part] : undefined),
        vars,
      );
    return value == null ? "" : String(value);
  });
}

export function t(key: string, vars?: Record<string, any>): string {
  const value = localeValue(key) ?? localeValue(key, "en-US");
  if (typeof value !== "string") return key;
  return fillTemplate(value, vars);
}

export function tc(key: string, count: number, vars?: Record<string, any>): string {
  const value = localeValue(key) ?? localeValue(key, "en-US");
  if (record(value)) {
    const text =
      (value as Record<string, any>)[count === 1 ? "one" : "other"] ??
      (value as Record<string, any>).other ??
      (value as Record<string, any>).one;
    if (typeof text === "string") return fillTemplate(text, { count, ...vars });
  }
  return t(key, { count, ...vars });
}

export function localeTag(): string {
  return sanitizeLocale(currentLocale);
}

export function getLocale(): string {
  return currentLocale;
}

// ── Locale loading ──

export async function loadLocale(locale: string): Promise<void> {
  const normalized = sanitizeLocale(locale);
  if (messages[normalized]) return; // already loaded
  const data = await fetch(`i18n/${normalized}.json`)
    .then((res) => (res.ok ? res.json() : {}))
    .catch(() => ({}));
  messages[normalized] = record(data) ? data : {};
}

export async function setLocale(locale: string): Promise<void> {
  const normalized = sanitizeLocale(locale);
  await loadLocale(normalized);
  currentLocale = normalized;
  setI18nReady(true);
  if (typeof document !== "undefined") {
    document.documentElement.lang = normalized;
    applyI18n(document);
  }
  setLocaleState(normalized);
}

/** Pre-load all supported locales (mirrors app.js loadI18n). */
export async function loadAllLocales(): Promise<void> {
  const entries = await Promise.all(
    SUPPORTED_LOCALES.map(async (locale) => {
      const data = await fetch(`i18n/${locale}.json`)
        .then((res) => (res.ok ? res.json() : {}))
        .catch(() => ({}));
      return [locale, record(data) ? data : {}] as [string, any];
    }),
  );
  for (const [locale, data] of entries) {
    messages[locale] = data;
  }
  setI18nReady(true);
}

/** Inject pre-loaded locale data (used when app.js already loaded i18n). */
export function setLocaleData(locale: string, data: Record<string, any>): void {
  messages[locale] = data;
}

/** Sync locale from app.js state (called by bridge code). */
export function syncLocaleFromLegacy(locale: string, allMessages: Record<string, any>): void {
  currentLocale = sanitizeLocale(locale);
  messages = { ...allMessages };
}

// ── DOM helpers ──

/**
 * Collect all elements within `root` that match `selector`.
 * When `root` itself is an Element and matches the selector it is included.
 * TODO: DOM side — callers that need server-side rendering should avoid this.
 */
export function i18nTargets(root: Document | Element, selector: string): Element[] {
  const items: Element[] = [];
  if (root instanceof Element && root.matches(selector)) items.push(root);
  (root as Element).querySelectorAll?.(selector)?.forEach((node) => items.push(node));
  return items;
}

/**
 * Walk `root` and replace text / attributes driven by data-i18n-* attributes
 * with the current locale's translated strings.
 * Supported attributes:
 * data-i18n → textContent
 * data-i18n-html → innerHTML
 * data-i18n-placeholder → placeholder attribute
 * data-i18n-title → title attribute
 * data-i18n-aria-label → aria-label attribute
 * data-i18n-alt → alt attribute
 * TODO: DOM side — this function mutates the live DOM.
 */
export function applyI18n(root: Document | Element = document): void {
  i18nTargets(root, "[data-i18n]").forEach((node) => {
    node.textContent = t((node as HTMLElement).dataset.i18n!);
  });
  i18nTargets(root, "[data-i18n-html]").forEach((node) => {
    (node as Element).innerHTML = t((node as HTMLElement).dataset.i18nHtml!);
  });
  i18nTargets(root, "[data-i18n-placeholder]").forEach((node) => {
    node.setAttribute("placeholder", t((node as HTMLElement).dataset.i18nPlaceholder!));
  });
  i18nTargets(root, "[data-i18n-title]").forEach((node) => {
    node.setAttribute("title", t((node as HTMLElement).dataset.i18nTitle!));
  });
  i18nTargets(root, "[data-i18n-aria-label]").forEach((node) => {
    node.setAttribute("aria-label", t((node as HTMLElement).dataset.i18nAriaLabel!));
  });
  i18nTargets(root, "[data-i18n-alt]").forEach((node) => {
    node.setAttribute("alt", t((node as HTMLElement).dataset.i18nAlt!));
  });
}
