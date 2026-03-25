// ── Lightweight Markdown Renderer ──
// Exact port of renderMarkdown / renderMarkdownBlock / inlineMarkdown from app.js.

export function escapeHtml(str: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function inlineMarkdown(text: string): string {
  let s = escapeHtml(text);
  function unescapeUrl(url: string): string {
    return url
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"');
  }
  function safeUrl(url: string, image = false): string | null {
    const value = unescapeUrl(url).trim();
    if (!value) return null;
    const lower = value.toLowerCase();
    if (lower.startsWith("javascript:") || lower.startsWith("vbscript:")) return null;
    if (lower.startsWith("data:"))
      return image && lower.startsWith("data:image/") ? value : null;
    if (
      lower.startsWith("https://") ||
      lower.startsWith("http://") ||
      lower.startsWith("mailto:") ||
      value.startsWith("/") ||
      value.startsWith("./") ||
      value.startsWith("../") ||
      value.startsWith("#")
    )
      return value;
    return null;
  }
  // Images: ![alt](url)
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => {
    const value = safeUrl(url, true);
    return value ? `<img class="md-img" src="${value}" alt="${alt}" loading="lazy">` : alt;
  });
  // Links: [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    const value = safeUrl(url);
    return value
      ? `<a class="md-link" href="${value}" target="_blank" rel="noopener">${label}</a>`
      : label;
  });
  // Bold: **text**
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Italic: *text*
  s = s.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");
  // Inline code: `code`
  s = s.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');
  return s;
}

export function renderMarkdownBlock(text: string): string {
  const lines = text.split("\n");
  let html = "";
  let inList = false;
  let listTag = "ul";

  for (const line of lines) {
    const trimmed = line.trim();

    // Headers
    const hMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (hMatch) {
      if (inList) {
        html += `</${listTag}>`;
        inList = false;
      }
      const level = hMatch[1].length;
      html += `<div class="md-h${level}">${inlineMarkdown(hMatch[2])}</div>`;
      continue;
    }

    // Unordered list
    if (/^[-*]\s/.test(trimmed)) {
      if (!inList || listTag !== "ul") {
        if (inList) html += `</${listTag}>`;
        html += '<ul class="md-list">';
        inList = true;
        listTag = "ul";
      }
      html += `<li>${inlineMarkdown(trimmed.slice(2))}</li>`;
      continue;
    }

    // Ordered list
    const olMatch = trimmed.match(/^(\d+)\.\s(.+)$/);
    if (olMatch) {
      if (!inList || listTag !== "ol") {
        if (inList) html += `</${listTag}>`;
        html += '<ol class="md-list">';
        inList = true;
        listTag = "ol";
      }
      html += `<li>${inlineMarkdown(olMatch[2])}</li>`;
      continue;
    }

    // End list on blank line or non-list content
    if (inList) {
      html += `</${listTag}>`;
      inList = false;
    }

    // Blank line
    if (!trimmed) {
      html += '<div class="md-break"></div>';
      continue;
    }

    // Regular paragraph
    html += `<div class="md-p">${inlineMarkdown(trimmed)}</div>`;
  }

  if (inList) html += `</${listTag}>`;
  return html;
}

export function renderMarkdown(text: string): string {
  // Split by fenced code blocks
  const segments = text.split(/(```[\s\S]*?```)/g);
  let html = "";
  for (const seg of segments) {
    if (seg.startsWith("```")) {
      const match = seg.match(/^```(\w*)\n?([\s\S]*?)```$/);
      const code = match ? match[2] : seg.slice(3, -3);
      html += `<pre class="md-code-block"><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`;
    } else {
      html += renderMarkdownBlock(seg);
    }
  }
  return html;
}
