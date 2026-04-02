const TEXT_APP_MIMES = new Set([
  "application/json",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/toml",
  "application/x-toml",
  "application/javascript",
  "application/typescript",
  "application/x-sh",
  "application/x-shellscript",
  "application/sql",
])

const TEXT_EXTS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "py", "go", "rs", "c", "cpp", "h", "hpp",
  "java", "rb", "sh", "bat", "ps1",
  "html", "css", "scss", "less",
  "sql", "toml", "yaml", "yml",
  "json", "xml", "csv", "log",
  "md", "markdown", "txt", "rst",
])

/**
 * Returns true if the MIME type (+ optional filename) represents text content
 * that should be decoded and injected as readable text, rather than passed as
 * a binary file part to the model.
 */
export function isDecodableText(mime: string, filename?: string): boolean {
  if (mime.startsWith("text/")) return true
  if (TEXT_APP_MIMES.has(mime)) return true
  if (mime === "application/octet-stream" && filename) {
    const ext = filename.split(".").pop()?.toLowerCase() ?? ""
    return TEXT_EXTS.has(ext)
  }
  return false
}

/**
 * Extract and decode the base64 payload from a data URL to UTF-8 text.
 * e.g. "data:text/markdown;base64,IyBIZWxsbw==" → "# Hello"
 */
export function decodeDataUrlText(dataUrl: string): string {
  const commaIndex = dataUrl.indexOf(",")
  if (commaIndex === -1) return ""
  return Buffer.from(dataUrl.slice(commaIndex + 1), "base64").toString("utf-8")
}
