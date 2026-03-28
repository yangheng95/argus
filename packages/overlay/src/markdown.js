export function createMarkdownRenderer(input) {
  const escapeHtml = input.escapeHtml;

  function inlineMarkdown(text) {
    let value = escapeHtml(text);
    value = value.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img class="md-img" src="$2" alt="$1" loading="lazy">');
    value = value.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a class="md-link" href="$2" target="_blank" rel="noopener">$1</a>');
    value = value.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    value = value.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");
    value = value.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');
    return value;
  }

  function renderMarkdownBlock(text) {
    const lines = text.split("\n");
    let html = "";
    let inList = false;
    let listTag = "ul";

    for (const line of lines) {
      const trimmed = line.trim();

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

      if (inList) {
        html += `</${listTag}>`;
        inList = false;
      }

      if (!trimmed) {
        html += '<div class="md-break"></div>';
        continue;
      }

      html += `<div class="md-p">${inlineMarkdown(trimmed)}</div>`;
    }

    if (inList) html += `</${listTag}>`;
    return html;
  }

  function renderMarkdown(text) {
    const segments = text.split(/(```[\s\S]*?```)/g);
    let html = "";
    for (const segment of segments) {
      if (segment.startsWith("```")) {
        const match = segment.match(/^```(\w*)\n?([\s\S]*?)```$/);
        const code = match ? match[2] : segment.slice(3, -3);
        html += `<pre class="md-code-block"><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`;
        continue;
      }
      html += renderMarkdownBlock(segment);
    }
    return html;
  }

  return {
    renderMarkdown,
  };
}
