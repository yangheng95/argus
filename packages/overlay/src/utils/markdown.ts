// ── Markdown Renderer (powered by marked + highlight.js) ──

import { marked } from "marked";
import hljs from "highlight.js/lib/core";
import langTS from "highlight.js/lib/languages/typescript";
import langJS from "highlight.js/lib/languages/javascript";
import langPy from "highlight.js/lib/languages/python";
import langRust from "highlight.js/lib/languages/rust";
import langGo from "highlight.js/lib/languages/go";
import langJava from "highlight.js/lib/languages/java";
import langCpp from "highlight.js/lib/languages/cpp";
import langCSS from "highlight.js/lib/languages/css";
import langXML from "highlight.js/lib/languages/xml";
import langJSON from "highlight.js/lib/languages/json";
import langYAML from "highlight.js/lib/languages/yaml";
import langBash from "highlight.js/lib/languages/bash";
import langSQL from "highlight.js/lib/languages/sql";
import langMD from "highlight.js/lib/languages/markdown";
import langDiff from "highlight.js/lib/languages/diff";

// Register languages (selective import keeps bundle small)
const LANGUAGES: [string, any][] = [
  ["typescript", langTS], ["javascript", langJS], ["python", langPy],
  ["rust", langRust], ["go", langGo], ["java", langJava], ["cpp", langCpp],
  ["css", langCSS], ["xml", langXML], ["json", langJSON], ["yaml", langYAML],
  ["bash", langBash], ["sql", langSQL], ["markdown", langMD], ["diff", langDiff],
];
for (const [name, lang] of LANGUAGES) hljs.registerLanguage(name, lang);

// ── Extension → language mapping ──

const EXT_LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  py: "python", pyi: "python",
  rs: "rust",
  go: "go",
  java: "java",
  c: "cpp", h: "cpp", cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp",
  css: "css", scss: "css", less: "css",
  html: "xml", htm: "xml", xml: "xml", svg: "xml",
  json: "json", jsonc: "json",
  yaml: "yaml", yml: "yaml", toml: "yaml",
  sh: "bash", bash: "bash", zsh: "bash",
  sql: "sql",
  md: "markdown", mdx: "markdown",
  diff: "diff", patch: "diff",
};

export function extToLang(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return EXT_LANG[ext] ?? "plaintext";
}

// ── Configure marked with hljs code renderer ──

marked.setOptions({ async: false, gfm: true, breaks: false });

marked.use({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      const language = lang && hljs.getLanguage(lang) ? lang : "";
      if (!language) return `<pre><code>${escapeHtml(text)}</code></pre>`;
      const highlighted = hljs.highlight(text, { language }).value;
      return `<pre><code class="hljs language-${language}">${highlighted}</code></pre>`;
    },
    codespan({ text }: { text: string }) {
      // `text` is the raw codespan content (before HTML escaping). Always
      // escape before emitting — the default renderer does the same.
      const path = extractFilePath(text);
      if (path) {
        const { display, target } = path;
        return `<code><a class="file-link" href="#" data-file-path="${escapeAttr(target)}">${escapeHtml(display)}</a></code>`;
      }
      return `<code>${escapeHtml(text)}</code>`;
    },
  },
});

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

// File-ish extensions we treat as path indicators when no slash is present.
const FILE_EXT_RE =
  /\.(?:ts|tsx|js|jsx|mts|cts|mjs|cjs|json|jsonc|md|mdx|css|scss|less|html|htm|xml|svg|yaml|yml|toml|py|pyi|rs|go|java|c|h|cpp|cc|cxx|hpp|sh|bash|zsh|sql|rb|php|lua|kt|swift|dart|vue|astro|conf|ini|env|lock|txt)$/i;

/**
 * Decide whether a codespan's text is a file path reference. Returns the
 * path to open (stripped of trailing ":line[:col]") and the display label
 * (original text). Returns null for non-path content (commands, identifiers,
 * URLs, etc.).
 */
function extractFilePath(
  text: string,
): { display: string; target: string } | null {
  const s = text.trim();
  if (!s) return null;
  // Reject URLs and protocol-ish strings.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return null;
  // Reject whitespace (multi-word commands) and shell flags.
  if (/\s/.test(s)) return null;
  if (s.startsWith("-")) return null;
  // Strip trailing :line[:col] for the target path.
  const locMatch = s.match(/^(.+?)(:\d+(?::\d+)?)$/);
  const pathPart = locMatch ? locMatch[1] : s;
  // Must look like a valid file token (letters/digits/underscore/dot/dash
  // plus path separators and optional './' or '../' prefix).
  if (!/^[\w./\\@~-]+$/.test(pathPart)) return null;
  const hasSlash = /[\/\\]/.test(pathPart);
  const hasFileExt = FILE_EXT_RE.test(pathPart);
  // Require either a path separator OR a recognisable file extension —
  // this filters out bare identifiers like `foo` or `useState`.
  if (!hasSlash && !hasFileExt) return null;
  // Reject isolated extensions like ".ts".
  if (/^\.\w+$/.test(pathPart)) return null;
  return { display: s, target: pathPart };
}

// ── Core rendering functions ──

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

// ── Code block rendering for tool outputs ──

const CODE_TRUNCATE_LINES = 100;

export function renderCodeBlock(
  content: string,
  lang: string,
  maxLines = CODE_TRUNCATE_LINES,
): { html: string; truncated: boolean; totalLines: number } {
  const lines = content.split("\n");
  const truncated = lines.length > maxLines;
  const display = truncated ? lines.slice(0, maxLines).join("\n") : content;
  const html = renderMarkdown("```" + lang + "\n" + display + "\n```");
  return { html, truncated, totalLines: lines.length };
}
