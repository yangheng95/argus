# Landing platform download dialog implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Sub-Agent execution is unavailable in this side conversation.

**Goal:** Replace the bilingual hero build action with a platform-selection download dialog that resolves and downloads the newest Windows x64 or macOS Apple Silicon package from the approved plugin-history APIs.

**Architecture:** A small pure TypeScript module owns the two platform sources and validates/resolves the newest package by `mtime`; it is testable without rendering UI. `landing.ts` owns bilingual visible strings, while `Lander.astro` owns the hero trigger, native dialog, DOM-driven loading/error facts, platform recommendation, and real download activation. Successful package URLs live only in the current dialog DOM session; no backend, persistent cache, or hard-coded package fallback is introduced.

**Tech Stack:** TypeScript, Zod 3, Astro 5/Starlight, native HTML `<dialog>`, Fetch API, Bun positive contract tests, Node-launched visible Microsoft Edge.

## Global constraints

- Windows history is `https://mirror.myhexin.com/backend/plugin/v1/history?plugin_id=37`; macOS history is `https://mirror.myhexin.com/backend/plugin/v1/history?plugin_id=34`.
- Select the greatest valid `mtime`, not semantic `plugin_version`.
- Accept only `status_code === 0`, a non-empty valid `data` array, host `mirror.myhexin.com`, and path prefix `/oss/aigc-mirror.mirror-plugin/`.
- Preserve the returned path/query and normalize only `http:` to `https:`.
- Windows is x64 `.exe.xz`; macOS is Apple Silicon `.app.tar.gz`. Do not claim macOS Intel or Linux support.
- Environment detection is recommendation-only; visitors explicitly choose a platform.
- Do not add a hard-coded package URL, fallback package source, automatic installer, backend proxy, new component library, or persistent package cache.
- Preserve the existing uncommitted Chinese-copy hunk in `packages/web/src/content/landing.ts`; stage the final file only after reviewing the combined diff.
- Do not add, modify, or run User Interface (UI) automated tests. UI acceptance uses a real visible browser and manually inspected screenshots.
- Desktop-only scope at approximately 1,440 pixels. No mobile or responsive redesign.
- Commit subjects start with `dsw-33987`; push to `myhexin` without bypassing hooks.

## Recall

| Item | Recorded context |
| --- | --- |
| User request | Replace `开始构建` with a one-click download button, distinguish Windows and macOS, use plugin-history APIs to obtain the latest links, let the visitor select the environment, and synchronize Chinese/English. |
| Approved design | Native platform-selection dialog with recommendation-only browser detection and explicit Windows x64/macOS Apple Silicon choices. |
| Verified API evidence | Both history endpoints return HTTP 200 and allow `https://opencorvus.ai` plus local preview origins. The returned asset URLs support HTTPS byte-range `GET`; `HEAD` returns 404 and is not an availability contract. |
| Latest selection | Windows example contains `v0.0.26` with a later `mtime` than `1.0.0`; therefore `mtime` is authoritative. |
| Existing owners | `landing.ts` owns localized copy; `Lander.astro` owns hero actions, native dialog precedent, interaction script, and local styles. |
| Existing work | `landing.ts` contains an unrelated uncommitted Chinese scenario-title change. It must remain intact through implementation and delivery. |
| Hard constraints | One current source per platform, no package fallback, no UI tests, real browser/download-request evidence, root `specs/` records and indexes, git-cc push. |
| Independent agent feedback | None; side-conversation rules prohibit sub-Agent delegation. |

---

### Task 1: Build the positive package-history resolver contract

**Files:**
- Create: `packages/web/src/lib/landing-download.ts`
- Create: `packages/opencorvus/test/script/landing-download-contract.test.ts`

**Interfaces:**
- Produces `DownloadPlatformId = "windows" | "macos"`.
- Produces `landingDownloadPlatforms`, an immutable catalog containing `id`, `historyUrl`, and `packageType`.
- Produces `resolveLatestLandingDownload(payload: unknown): { version: string; modifiedAt: string; url: string }`.

- [x] **Step 1: Write the positive resolver test**

Create a non-UI Bun test that supplies the observed Windows-style response with an older `1.0.0` record and a newer `v0.0.26` record. Assert one complete positive result:

```ts
expect(resolveLatestLandingDownload(payload)).toEqual({
  version: "v0.0.26",
  modifiedAt: "2026-07-31 13:34:56",
  url: "https://mirror.myhexin.com/oss/aigc-mirror.mirror-plugin/newest.exe.xz",
})
```

Also assert the platform catalog contains the exact Windows plugin ID `37` and macOS plugin ID `34` history URLs with `.exe.xz` and `.app.tar.gz` types. These are positive current-contract assertions, not UI or retired-path assertions.

- [x] **Step 2: Run the focused test and observe the missing-module failure**

Run:

```powershell
bun test packages/opencorvus/test/script/landing-download-contract.test.ts
```

Expected: fail because `packages/web/src/lib/landing-download.ts` does not exist.

- [x] **Step 3: Implement the resolver with Zod**

Use Zod to require `status_code: 0`, at least one record, `mtime` matching `YYYY-MM-DD HH:mm:ss`, non-empty version, and URL. Sort valid records by descending `mtime`, parse the selected URL, require the approved host/path prefix, replace `http:` with `https:`, and return the exact result type. Throw one typed `LandingDownloadContractError` when the response or selected URL violates the contract; do not return a fallback.

- [x] **Step 4: Run the focused test**

Run the command from Step 2. Expected: all positive package-history contract assertions pass.

### Task 2: Add bilingual content and native dialog interaction

**Files:**
- Modify: `packages/web/src/content/landing.ts`
- Modify: `packages/web/src/components/Lander.astro`

**Interfaces:**
- Consumes: `landingDownloadPlatforms` and `resolveLatestLandingDownload` from Task 1.
- Produces: localized `content.download` strings and a real hero-triggered dialog with DOM-session package facts.

- [x] **Step 1: Extend the bilingual content shape**

Add `download` to `LandingContent` with these semantic owners: trigger, dialog title/description/close, recommended, loading, retry, error, download action, version label, Windows name/architecture, and macOS name/architecture. Use `Download` / `一键下载` for the trigger and `Choose your download` / `选择安装包` for the dialog title.

Remove the dead hero primary link from the content shape. Change the existing secondary hero link to Quickstart in both locales (`Quickstart` and `快速上手`) so documentation remains available beside download.

- [x] **Step 2: Replace the hero primary link with a dialog trigger**

Render a real `<button type="button">` with the existing primary-button styling, `aria-haspopup="dialog"`, `aria-controls="landing-download-dialog"`, and `data-download-dialog-trigger`. Keep the Quickstart secondary link and replace its play glyph with the existing `open-book` icon.

- [x] **Step 3: Render one native download dialog**

After the existing image dialog, render `#landing-download-dialog` from `landingDownloadPlatforms`. Each platform button carries only stable catalog facts (`data-download-platform`, history URL, package type); version and resolved URL are initially absent. Include localized recommendation, version, loading, error/retry, package-type, close, and status surfaces.

- [x] **Step 4: Implement DOM-driven download behaviour**

On open, mark Windows or macOS recommended from `navigator.userAgent`, show the native dialog, and call one `loadPlatform(button)` per option. `loadPlatform` must:

1. return immediately when the button already has `data-download-url`;
2. disable only while its request is pending;
3. fetch its history endpoint with `Accept: application/json` and `lanetag: 002`;
4. resolve the payload through `resolveLatestLandingDownload`;
5. write version and safe URL into the row on success;
6. restore an enabled retry action with localized error text on failure.

When a resolved option is clicked, create and activate a temporary HTTPS anchor synchronously, then remove it. Close via the close button, Escape, or backdrop; preserve the existing image dialog behaviour.

- [x] **Step 5: Style the dialog with existing tokens**

Create a compact dark surface with a clear title, two side-by-side platform rows, restrained recommendation badge, version/type metadata, visible loading/error action, and the existing green primary accent. Reuse focus-visible styling. Keep all platform labels and controls readable without clipping at the desktop acceptance viewport.

### Task 3: Verify static and non-UI contracts

**Files:**
- Inspect: changed source and focused test.

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: verified resolver, error-free Astro source, production output, and scope evidence.

- [x] **Step 1: Run the focused resolver test**

Run the Task 1 test and confirm its positive current-package result.

- [x] **Step 2: Run Astro check and production build**

Run:

```powershell
bun run --cwd packages/web check
bun run --cwd packages/web build
```

Expected: exit code 0 and both `/docs/` and `/docs/zh-cn/` generated.

- [x] **Step 3: Review scope and package-source truth**

Review the full `landing.ts` diff and preserve the pre-existing Chinese scenario-title change. Confirm no literal `/oss/` package URL appears in production source, both platform API URLs come from the single catalog, and the component consumes the resolver rather than reimplementing latest selection.

### Task 4: Validate the real bilingual dialog and download requests

**Files:**
- Create: `specs/artifacts/landing-download-dialog-en.png`
- Create: `specs/artifacts/landing-download-dialog-zh-cn.png`

**Interfaces:**
- Consumes: live local pages and actual history endpoints.
- Produces: manual visual/interaction evidence, not a repeatable UI test or baseline.

- [x] **Step 1: Open the real English and Chinese pages**

Confirm HTTP 200 for `/docs/` and `/docs/zh-cn/`. In a visible Node-launched Edge session at approximately 1,440 pixels wide, open each hero download trigger and confirm localized title, platform labels, version/type metadata, recommendation badge, close/Escape, and focus restoration.

- [x] **Step 2: Observe both real package requests without transferring full archives**

Use the one-off visible browser session to intercept only the final `/oss/aigc-mirror.mirror-plugin/` requests after the user-level platform clicks. Record the HTTPS URL and abort the archive transfer after the real request is observed. Confirm Windows selected the greatest-`mtime` plugin `37` record and macOS selected the greatest-`mtime` plugin `34` record.

- [x] **Step 3: Capture and personally inspect both locales**

Capture focused task screenshots for the open English and Chinese dialogs. Inspect layout, hierarchy, recommendation semantics, mixed-language spacing, versions, package types, loading/error affordance, and clipping. Correct source and repeat verification if the real page differs from the approved design.

### Task 5: Record evidence and deliver

**Files:**
- Modify: `specs/records/2026-08/2026-08-04-landing-platform-download-dialog-implementation-plan.md`
- Modify: `specs/README.md`
- Modify: `specs/records/2026-08/README.md`

**Interfaces:**
- Consumes: final diff, commands, API responses, real browser facts, and screenshots.
- Produces: indexed evidence, scoped commits, and git-cc delivery.

- [x] **Step 1: Run documentation-contract tests**

Run:

```powershell
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
```

- [x] **Step 2: Append implementation evidence**

Record exact focused/static/docs results, live URLs, platform recommendations, resolved versions/URLs, intercepted request evidence, screenshots personally inspected, and second source-review verdict.

- [x] **Step 3: Commit and push scoped delivery**

Stage the resolver, positive test, component, complete reviewed `landing.ts`, this plan/indexes, and task screenshots. Explicitly record that the existing Chinese scenario-title hunk was preserved and included with user work. Commit with a `dsw-33987` subject and push to `myhexin` without bypassing hooks.

## Implementation evidence

- Resolver TDD: the first focused run failed because `packages/web/src/lib/landing-download.ts` did not exist. After implementation, `bun test packages/opencorvus/test/script/landing-download-contract.test.ts` passed 2 tests with 0 failures. The positive fixture proves that the greatest `mtime` wins even when the older record has version `1.0.0`, and that the returned URL uses HTTPS.
- Static validation: `bun run --cwd packages/web check` reported 0 errors and 0 warnings, with one pre-existing unused-variable hint in `qa/dedupe-lead.cjs`. A fresh standalone `bun run --cwd packages/web build` generated 105 pages, including the English and Simplified Chinese landing routes. One combined check/build invocation was terminated once with Windows exit code 9; the failure did not reproduce when the build ran standalone and no source change was needed.
- Live page availability: `http://localhost:9999/docs/` and `http://localhost:9999/docs/zh-cn/` both returned HTTP 200.
- Live package resolution on 2026-08-04:
  - Windows plugin `37` resolved `v0.0.26` at `https://mirror.myhexin.com/oss/aigc-mirror.mirror-plugin/01364f0b-c62c-4c6c-87f9-81b72bb5e0cd_1785476096678.0.26.exe.xz`; a one-byte Range GET returned HTTP 206 and `Content-Range: bytes 0-0/209480184`.
  - macOS plugin `34` resolved `1.0.0` at `https://mirror.myhexin.com/oss/aigc-mirror.mirror-plugin/1b392a02-e889-4343-8936-23df118ac2eb_1785295021543.0.24-beta_aarch64.app.tar.gz`; a one-byte Range GET returned HTTP 206 and `Content-Range: bytes 0-0/180343018`.
- Real interaction: a visible Microsoft Edge session clicked each platform row. Both HTTPS `/oss/aigc-mirror.mirror-plugin/` requests were observed and intentionally aborted before archive transfer. A separate visible Edge keyboard pass confirmed Escape closes the dialog and restores focus to the hero download trigger.
- External failure handling: one in-app-browser Windows history request returned `TypeError: Failed to fetch` while macOS succeeded. Both history endpoints simultaneously returned HTTP 200 with the expected local-origin CORS headers; clicking the visible Windows `重新获取` action resolved `v0.0.26` in the same dialog. This verifies the scoped error/retry contract without adding a second source or automatic retry.
- Visual review: the first English screenshot exposed a theme reset that positioned the native dialog at the top-left. Adding explicit `inset: 0` and `margin: auto` corrected the root layout issue. The corrected English dialog measured 832 by approximately 433 pixels and was centered at approximately `(296, 284)` in a 1,425 by 1,000 viewport. Windows alone carried the current-device recommendation on the Windows browser. English and Chinese copies, two-column hierarchy, versions, architectures, package types, actions, focus ring, and clipping were personally inspected.
- Screenshot evidence: [`landing-download-dialog-en.png`](../../artifacts/landing-download-dialog-en.png) and [`landing-download-dialog-zh-cn.png`](../../artifacts/landing-download-dialog-zh-cn.png).
- Source review: production source contains no resolved package URL; the two history endpoints and package types exist only in `landingDownloadPlatforms`, and `Lander.astro` consumes the shared resolver. The pre-existing Chinese scenario title `沿着当前上下文，把问题一次查清。` remains intact in the combined `landing.ts` diff. No User Interface (UI) automated test, fixture, or screenshot baseline was added or run.
- Delivery: feature commit `e865df867c` (`dsw-33987 add landing platform downloads`) passed the git-cc pre-push typecheck, route inventory, documentation generation, i18n, and secret-scan hooks and was pushed to `myhexin/work-lcx-v0.0.30beta`.

## Plan self-review

- Spec coverage: platform catalog, newest-by-`mtime` resolver, bilingual content, explicit selection, recommendation-only detection, native dialog, loading/error/retry, HTTPS download activation, positive contract test, static build, real requests, screenshots, evidence, and push all have owners.
- Placeholder scan: no deferred implementation step exists. API URLs, plugin IDs, platform/architecture types, validation, and interaction behaviour are exact.
- Type consistency: the resolver and catalog names are identical across producer, test, and Astro consumer; both locale objects satisfy one `LandingContent.download` shape.
- UI boundary: the only automated test covers the non-UI package-history resolver. All visible and interactive claims are accepted through a one-off real browser session and manual screenshots.
