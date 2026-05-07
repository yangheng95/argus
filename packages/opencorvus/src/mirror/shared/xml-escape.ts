/**
 * XML escape utilities for safe attribute and text encoding.
 * Ported from mirror/src/infra/utils/xml-escape.ts.
 */

/** Escape a string for use inside an XML attribute value (double-quoted). */
export function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

/** Escape a string for use as XML text content. */
export function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}
