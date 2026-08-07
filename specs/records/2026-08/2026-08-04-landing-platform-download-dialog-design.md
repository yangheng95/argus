# Landing platform download dialog design

## Recall

| Item | Recorded context |
| --- | --- |
| User request | Replace the landing-page `开始构建` action with a one-click download entry, distinguish Windows and macOS, and synchronize the feature across Simplified Chinese and English. |
| Approved interaction | A platform-selection dialog opened from the hero download button. The visitor explicitly selects Windows x64 or macOS Apple Silicon; selection fetches the current package and begins download. |
| Package sources | Windows history: `https://mirror.myhexin.com/backend/plugin/v1/history?plugin_id=37`. macOS history: `https://mirror.myhexin.com/backend/plugin/v1/history?plugin_id=34`. |
| Latest-package rule | Select the record with the greatest parsed `mtime`, not the greatest semantic `plugin_version`, because the Windows history currently contains inconsistent version formatting and upload order is the reliable release fact. |
| Verified current evidence | On 2026-08-04 the Windows API returned `v0.0.26` as the newest upload and the macOS API returned `1.0.0`. Both API routes returned HTTP 200 and allowed the `https://opencorvus.ai` and local preview origins. The asset paths accept HTTPS `GET` with byte ranges even though the API returns HTTP URLs; HTTPS `HEAD` is not supported and must not be used as availability evidence. |
| Existing page ownership | `packages/web/src/content/landing.ts` owns bilingual hero and dialog copy. `packages/web/src/components/Lander.astro` owns hero actions, the existing native image dialog, component-local styles, and page interaction script. |
| Working-tree safety | `packages/web/src/content/landing.ts` already has an unrelated uncommitted Chinese-copy change from the parent task. Download implementation must preserve that work and stage only its own reviewed hunks plus new download owners. |
| Hard constraints | Keep one current package source per platform, no hard-coded package fallback, no fake download success, no User Interface (UI) automated tests, real desktop interaction and screenshots required, and no mobile delivery. |
| Independent agent feedback | None; side-conversation and collaboration rules prohibit sub-Agent delegation. |

## Decision

Add one bilingual hero download action that opens a native platform-selection dialog. The dialog exposes two truthful choices—Windows x64 and macOS Apple Silicon—and marks the browser-detected family as recommended without automatically choosing it.

The visitor remains the final platform authority. Browser detection is advisory because user-agent data cannot reliably distinguish every macOS CPU architecture and a wrong automatic download is more costly than one explicit choice.

## Considered approaches

1. **Platform-selection dialog — approved.** Clear platform authority, compact hero, real version feedback, and recoverable fetch errors.
2. **Immediate automatic download.** One fewer click, but unreliable macOS architecture inference can deliver the wrong package.
3. **Two permanent hero buttons.** Technically direct, but crowds the first viewport and weakens the existing documentation/source hierarchy.

## Content and visual contract

- Chinese hero action: `一键下载`; English hero action: `Download`.
- Dialog title: `选择安装包` / `Choose your download`.
- Platform rows:
  - `Windows` / `Windows x64`, package source plugin ID `37`.
  - `macOS` / `Apple Silicon`, package source plugin ID `34`.
- A detected Windows or macOS family receives a restrained `推荐` / `Recommended` badge. Unsupported or unknown environments receive no recommendation.
- Each platform row displays loading, resolved version, and package type. Windows identifies `.exe.xz`; macOS identifies `.app.tar.gz`.
- The existing Quickstart action remains available as the secondary hero action. Documentation and source links remain unchanged.
- Reuse the current landing tokens, focus-visible treatment, button hierarchy, and native `<dialog>` pattern. Do not introduce a component library or a second visual system.

## Data contract

Define one platform catalog with stable IDs, localized labels, architecture text, package type, and history URL. The history response is accepted only when:

1. the HTTP request succeeds;
2. `status_code === 0`;
3. `data` is a non-empty array;
4. at least one record has a parseable `mtime` and a non-empty `plugin_url`;
5. the selected URL belongs to `mirror.myhexin.com` and its path begins `/oss/aigc-mirror.mirror-plugin/`.

Select the valid record with the greatest parsed `mtime`. Preserve the returned path and query, replace only the `http:` protocol with `https:`, then navigate a real anchor to that URL. Do not cache or embed a package URL in source; the history endpoint is the only package-address authority.

## Interaction and error handling

1. Activating the hero button opens the dialog and starts both history requests so version information appears promptly.
2. Selecting a resolved platform immediately starts its download through a real HTTPS anchor.
3. While a platform request is pending, its action shows a loading label and cannot be activated twice.
4. If one platform fails, only that row shows its localized error and retry action; the other platform remains usable.
5. Closing and reopening the dialog preserves only successful responses for the current page session. A failed request is retried explicitly; there is no stale or hard-coded package fallback.
6. Escape, the close button, backdrop click, and restored focus follow the existing native dialog behaviour.

## Ownership

| Owner | Responsibility |
| --- | --- |
| `packages/web/src/content/landing.ts` | Bilingual download labels, recommendation, loading, error, retry, package-type, and dialog accessibility copy. |
| `packages/web/src/components/Lander.astro` | Hero download trigger, native dialog markup, platform catalog, safe response resolution, browser-family recommendation, download activation, focus/dialog lifecycle, and component-local styles. |
| Existing package-history APIs | The single current version and package URL source for each platform. |

No backend proxy is required because the verified API permits production and local-preview origins and the package paths support HTTPS range `GET`.

## Verification

- Run the Astro checker and production build.
- Do not add, modify, or run UI automated tests, source-string assertions, snapshots, or visual baselines.
- Use the real local page at a desktop viewport. Open the dialog from both locale pages, confirm localized content, recommendation labelling, keyboard focus, Escape/close behaviour, and error-safe states.
- In visible browser sessions, exercise the Windows and macOS selections while preventing full package transfer after the real HTTPS request is observed. Confirm the selected request uses the newest `mtime` record from the corresponding plugin history.
- Capture and personally inspect focused English and Chinese dialog screenshots. Confirm no clipping, clear architecture labels, readable version/type metadata, and no false macOS Intel claim.
- Run required historical-document, document-health, and product-document single-source tests after indexing this record.

## Non-goals

- Linux download support.
- macOS Intel support until a separate current package source exists.
- Automatic installation after download.
- Decompressing `.xz` or `.tar.gz` in the browser.
- Persisting package history outside the current page session.
- Mobile or responsive redesign.

## Self-review

- Placeholder scan: every platform source, selection rule, validation rule, user-visible state, and acceptance step is explicit.
- Consistency: both locales use one interaction and one platform catalog; the two plugin history endpoints remain the only package URL sources.
- Scope: one hero action, one dialog, and two current desktop platforms; no installer backend or unrelated page redesign.
- Ambiguity: “latest” means greatest valid `mtime`; “macOS” means Apple Silicon only; recommendation never performs automatic selection.
