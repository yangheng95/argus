// ── FileReader → data URL ──
//
// audit-2026-04-29 W2-V18. Lifted out of ChatComposer.tsx so the
// FileReader rejection contract is unit-testable without rendering
// the component.

/**
 * Encode a File as a base64 data URL via FileReader.
 *
 * Rejects (does NOT swallow) on:
 *   - reader.onerror (file deleted mid-read, EACCES, browser quota)
 *   - reader.onabort (caller aborted via reader.abort, currently unused)
 *
 * The caller (ChatComposer.addAttachment, post-V18) catches the
 * rejection and surfaces a user-visible toast, then returns —
 * critically, addAttachment must NOT re-throw because the file-input
 * loop's `for (file of files) await addAttachment(file)` would abort
 * on the first failure and silently drop subsequent files.
 *
 * This split lets us test:
 *   - the happy-path returns a `data:...;base64,...` URL,
 *   - the error-path is a Promise rejection (not a hung promise),
 *
 * without needing a real FileReader running in jsdom — Bun's test
 * runner doesn't ship one. The implementation goes through the
 * native FileReader at runtime; the unit tests inject a fake.
 */
export interface FileReaderLike {
  onload: (() => void) | null
  onerror: (() => void) | null
  result: string | ArrayBuffer | null
  readAsDataURL(file: unknown): void
}

export type FileReaderFactory = () => FileReaderLike

let factory: FileReaderFactory = () => new FileReader() as unknown as FileReaderLike

export function __setFileReaderFactoryForTest(f: FileReaderFactory | undefined): void {
  factory = f ?? (() => new FileReader() as unknown as FileReaderLike)
}

export function fileToDataUrl(file: unknown): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = factory()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error("FileReader failed"))
    reader.readAsDataURL(file)
  })
}
