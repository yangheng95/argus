import { describe, expect, test } from "bun:test"
import { isComposerAttachPayload } from "../src/services/composer-attach-validate"

/**
 * audit-2026-04-29 W2-G7. Locks the receiver-side payload validator
 * for `composer.attach` ui-commands.
 *
 * Pre-fix the validator only checked that the four core fields were
 * strings — it accepted hostile shapes like `dataUrl: "javascript:..."`,
 * filenames carrying NUL bytes / BiDi spoofing characters, NaN /
 * negative selection ranges, and arbitrary mime tokens.
 *
 * Post-fix each rejection reason has a regression test below; the
 * happy-path test guards against over-tightening (the in-tree caller
 * `vscode-extension/src/commands/attach-file.ts` must keep working).
 */

function happyPath(): unknown {
  return {
    filename: "main.ts",
    mime: "text/typescript",
    dataUrl: "data:text/typescript;base64,Zm9v",
    sourcePath: "/Users/dev/proj/main.ts",
    selection: {
      startLine: 10,
      startColumn: 0,
      endLine: 12,
      endColumn: 5,
    },
  }
}

describe("isComposerAttachPayload (audit W2-G7)", () => {
  test("accepts the happy-path payload from attach-file command", () => {
    expect(isComposerAttachPayload(happyPath())).toBe(true)
  })

  test("accepts payload without selection (caller may omit it)", () => {
    const p = happyPath() as Record<string, unknown>
    delete p.selection
    expect(isComposerAttachPayload(p)).toBe(true)
  })

  test("accepts blob: dataUrl (overlay-internal staging path)", () => {
    const p = happyPath() as Record<string, unknown>
    p.dataUrl = "blob:vscode-webview://abc/1234-5678"
    expect(isComposerAttachPayload(p)).toBe(true)
  })

  // ── Rejection cases ────────────────────────────────────────────

  test("rejects non-data/blob dataUrl schemes (XSS surface)", () => {
    const cases = [
      "javascript:alert(1)",
      "https://evil.example.com/exfil.png",
      "file:///etc/passwd",
      "vbscript:msgbox",
      "Data:text/plain,abc", // case-sensitive — block exact-prefix only
    ]
    for (const u of cases) {
      const p = happyPath() as Record<string, unknown>
      p.dataUrl = u
      expect(isComposerAttachPayload(p)).toBe(false)
    }
  })

  test("rejects filename with NUL byte (path-truncation poisoning)", () => {
    const p = happyPath() as Record<string, unknown>
    p.filename = "good.ts\0../../etc/passwd"
    expect(isComposerAttachPayload(p)).toBe(false)
  })

  test("rejects filename with BiDi override characters (RTL spoofing)", () => {
    // Classic attack: "rtfo‮gpj.exe" renders as "rtfoexe.gpj"
    // — user thinks it's an image, gets an executable.
    const p = happyPath() as Record<string, unknown>
    p.filename = "rtfo‮gpj.exe"
    expect(isComposerAttachPayload(p)).toBe(false)
  })

  test("rejects filename with embedded newlines / control chars", () => {
    const cases = ["foo\n.ts", "foo\r\n.ts", "foo\t.ts", "foo\x01.ts", "foo\x7f.ts"]
    for (const f of cases) {
      const p = happyPath() as Record<string, unknown>
      p.filename = f
      expect(isComposerAttachPayload(p)).toBe(false)
    }
  })

  test("rejects empty filename", () => {
    const p = happyPath() as Record<string, unknown>
    p.filename = ""
    expect(isComposerAttachPayload(p)).toBe(false)
  })

  test("rejects mime that doesn't match type/subtype shape", () => {
    const cases = [
      "text", // missing slash
      "text/", // missing subtype
      "/plain", // missing type
      "text plain", // space
      "<script>", // injection attempt
      "",
    ]
    for (const m of cases) {
      const p = happyPath() as Record<string, unknown>
      p.mime = m
      expect(isComposerAttachPayload(p)).toBe(false)
    }
  })

  test("rejects selection with NaN / negative / non-integer fields", () => {
    const baseSel = () => ({ startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 })
    const broken = [
      { ...baseSel(), startLine: NaN },
      { ...baseSel(), startLine: Infinity },
      { ...baseSel(), startLine: -1 },
      { ...baseSel(), startLine: 1.5 },
      { ...baseSel(), startLine: "0" }, // string masquerading as number
      { ...baseSel(), endColumn: undefined },
    ]
    for (const sel of broken) {
      const p = happyPath() as Record<string, unknown>
      p.selection = sel
      expect(isComposerAttachPayload(p)).toBe(false)
    }
  })

  test("rejects entirely non-object inputs", () => {
    expect(isComposerAttachPayload(null)).toBe(false)
    expect(isComposerAttachPayload(undefined)).toBe(false)
    expect(isComposerAttachPayload("a string")).toBe(false)
    expect(isComposerAttachPayload(42)).toBe(false)
    expect(isComposerAttachPayload([happyPath()])).toBe(false)
  })

  test("rejects payload missing any required core field", () => {
    for (const k of ["filename", "mime", "dataUrl", "sourcePath"]) {
      const p = happyPath() as Record<string, unknown>
      delete p[k]
      expect(isComposerAttachPayload(p)).toBe(false)
    }
  })
})
