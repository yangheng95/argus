// ── Markdown Renderer (powered by marked) ──

import { marked } from "marked";

// Configure marked with GFM (tables, strikethrough, etc.)
marked.setOptions({
  async: false,
  gfm: true,
  breaks: false,
});

export function escapeHtml(str: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Render inline markdown only (no block-level elements). */
export function inlineMarkdown(text: string): string {
  return marked.parseInline(text) as string;
}

/** Render full markdown (block + inline). */
export function renderMarkdown(text: string): string {
  return marked.parse(text) as string;
}

/** Alias for renderMarkdown — used by some callers. */
export function renderMarkdownBlock(text: string): string {
  return renderMarkdown(text);
}
