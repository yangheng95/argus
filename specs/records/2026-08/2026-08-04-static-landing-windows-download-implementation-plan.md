# Static Landing Windows Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Sub-Agent execution is unavailable in this side conversation.

**Goal:** Build a deployable promotional-site `dist` that copies the existing Windows x64 artifacts into a static download directory and presents one inline, bilingual, direct NSIS installer download without a dialog or package-history request.

**Architecture:** `packages/web/src/lib/landing-download.ts` becomes a static Windows release catalog derived from the Overlay package version. A root distribution script validates the existing native artifact directory, runs the Astro build, copies the complete directory into `packages/web/dist/downloads/windows-x64/`, and verifies the copied file inventory and byte sizes. `Lander.astro` renders one native anchor from that catalog; no runtime package selection code remains.

**Tech Stack:** TypeScript, Bun filesystem/process APIs, Astro 5/Starlight, existing release-asset validator, native HTML anchors, Node-launched Astro preview, visible Browser/Playwright inspection.

## Global Constraints

- Do not invoke `package:gui-installer-matrix`, `build:overlay`, Tauri, Cargo, or any other native Windows/macOS build command.
- Use `packages/overlay/dist-artifacts/windows-x64/` as the only binary source and preserve it unchanged.
- Copy the complete source directory to `packages/web/dist/downloads/windows-x64/` after the Astro build.
- The one-click public asset is `OpenCorvus_<overlay-version>_x64-setup.exe`, with `<overlay-version>` read from `packages/overlay/package.json`.
- macOS, Linux, Windows ARM64, MSI selection, and portable-executable selection are outside the visible landing-page scope.
- Remove the package-history API resolver, macOS catalog row, runtime fetch, native download dialog, and dialog-only copy; retain no fallback or compatibility path.
- Do not add, modify, or run User Interface (UI) automated tests. UI acceptance uses a real page, visible browser interaction, and manually inspected screenshots only.
- Non-UI tests must assert positive catalog and file-copy results; do not add negative tests.
- Start Playwright or browser inspection through Node, never Bun.
- Preserve all unrelated Overlay working-tree modifications and stage only exact task files.
- Every commit subject starts with `dsw-33987`; push to `legacy-remote/work-lcx-v0.0.30beta` without bypassing hooks.

## Recall

| Item | Evidence |
| --- | --- |
| User decision | macOS is deferred; Windows artifacts must not be rebuilt. The promotional build copies the existing `packages/overlay/dist-artifacts/windows-x64` directory. |
| Current source directory | Contains `opencorvus-overlay.exe`, `OpenCorvus_0.0.30-beta_x64-setup.exe`, and `OpenCorvus_0.0.30-beta_x64_en-US.msi`. |
| Current Web ownership | `landing-download.ts` owns two history APIs and a Zod resolver; `Lander.astro` owns the dialog/fetch lifecycle; `landing.ts` owns bilingual dialog strings. |
| Current build ownership | `packages/web/package.json` exposes `astro build`; root `package.json` has no promotional distribution command. |
| Existing validation tool | `script/check-release-assets.ts overlay --dir <dir> --platform windows-x64 --version <version> --require-bundle` validates the existing executable, NSIS, and MSI bundle contract. |
| Reviewed design | `specs/records/2026-08/2026-08-04-static-landing-native-downloads-design.md`. |
| Independent agent feedback | None; side-conversation rules prohibit delegation. |

## File structure

| File | Responsibility |
| --- | --- |
| `packages/web/src/lib/landing-download.ts` | Single static Windows catalog: platform, Overlay version, source/destination directories, setup filename, relative public path, architecture, and installer kind. |
| `script/build-landing-dist.ts` | Validate the existing source, run Astro, copy the full artifact tree, inventory source/destination files, and verify byte-size equality. |
| `packages/opencorvus/test/script/landing-download-contract.test.ts` | Positive non-UI catalog and artifact-copy contract. Replaces the obsolete package-history resolver tests. |
| `package.json` | Expose `build:landing-dist` as the deployable promotional distribution command. |
| `packages/web/src/content/landing.ts` | Bilingual visible download-section wording only. |
| `packages/web/src/components/Lander.astro` | Hero anchor, inline Windows download section, native static download anchor, section styling, and existing image-preview behavior. |
| `specs/records/2026-08/2026-08-04-static-landing-windows-download-implementation-plan.md` | Implementation steps and final evidence. |
| `specs/README.md`, `specs/records/2026-08/README.md` | Canonical plan indexes. |
| `specs/artifacts/landing-windows-download-en.png`, `specs/artifacts/landing-windows-download-zh-cn.png` | One-off visual evidence from the real built page; not screenshot baselines. |

---

### Task 1: Replace remote package resolution with the static Windows distribution contract

**Files:**
- Modify: `packages/web/src/lib/landing-download.ts`
- Create: `script/build-landing-dist.ts`
- Modify: `packages/opencorvus/test/script/landing-download-contract.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `landingWindowsDownload`, with `platform`, `version`, `sourceDirectory`, `destinationDirectory`, `installerFileName`, `publicRelativePath`, `architecture`, and `packageType` string fields.
- Produces: `copyLandingWindowsArtifacts(repoRoot: string, contract?: LandingWindowsDownload): Promise<LandingArtifactCopyResult>`.
- Produces: `LandingArtifactCopyResult`, with `sourceDirectory`, `destinationDirectory`, `installerPath`, and `files: Array<{ relativePath: string; bytes: number }>`.
- Consumes: `packages/overlay/package.json#version` and the existing `script/check-release-assets.ts` CLI.

- [ ] **Step 1: Rewrite the focused test as a failing positive static-distribution contract**

Replace the API fixture tests with this contract shape:

```ts
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import overlayPackage from "../../../overlay/package.json"
import { landingWindowsDownload } from "../../../web/src/lib/landing-download"
import { copyLandingWindowsArtifacts } from "../../../../script/build-landing-dist"

describe("landing Windows distribution", () => {
  test("publishes the current Windows x64 setup contract", () => {
    const installerFileName = `OpenCorvus_${overlayPackage.version}_x64-setup.exe`
    expect(landingWindowsDownload).toEqual({
      platform: "windows-x64",
      version: overlayPackage.version,
      sourceDirectory: "packages/overlay/dist-artifacts/windows-x64",
      destinationDirectory: "packages/web/dist/downloads/windows-x64",
      installerFileName,
      publicRelativePath: `downloads/windows-x64/${installerFileName}`,
      architecture: "x64",
      packageType: "EXE",
    })
  })

  test("copies the complete Windows artifact directory with matching byte sizes", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "landing-windows-dist-"))
    try {
      const source = resolve(root, "packages/overlay/dist-artifacts/windows-x64")
      mkdirSync(source, { recursive: true })
      const fixtureFiles = {
        "opencorvus-overlay.exe": "overlay-binary",
        [`OpenCorvus_${overlayPackage.version}_x64-setup.exe`]: "nsis-installer",
        [`OpenCorvus_${overlayPackage.version}_x64_en-US.msi`]: "msi-installer",
      }
      for (const [name, value] of Object.entries(fixtureFiles)) writeFileSync(resolve(source, name), value)

      const result = await copyLandingWindowsArtifacts(root)

      expect(result.files).toEqual(
        Object.entries(fixtureFiles)
          .map(([relativePath, value]) => ({ relativePath, bytes: Buffer.byteLength(value) }))
          .sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
      )
      expect(readFileSync(result.installerPath, "utf8")).toBe("nsis-installer")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Run the focused test and record the expected failure**

Run:

```powershell
bun test packages/opencorvus/test/script/landing-download-contract.test.ts
```

Expected: failure because `copyLandingWindowsArtifacts` is not exported and `landingWindowsDownload` still exposes the old API-backed two-platform contract.

- [ ] **Step 3: Replace `landing-download.ts` with one version-derived catalog**

Implement the exact shape used by the test:

```ts
import overlayPackage from "../../../overlay/package.json"

const installerFileName = `OpenCorvus_${overlayPackage.version}_x64-setup.exe`

export type LandingWindowsDownload = {
  platform: "windows-x64"
  version: string
  sourceDirectory: string
  destinationDirectory: string
  installerFileName: string
  publicRelativePath: string
  architecture: "x64"
  packageType: "EXE"
}

export const landingWindowsDownload = {
  platform: "windows-x64",
  version: overlayPackage.version,
  sourceDirectory: "packages/overlay/dist-artifacts/windows-x64",
  destinationDirectory: "packages/web/dist/downloads/windows-x64",
  installerFileName,
  publicRelativePath: `downloads/windows-x64/${installerFileName}`,
  architecture: "x64",
  packageType: "EXE",
} as const satisfies LandingWindowsDownload
```

Delete Zod, both history URLs, `DownloadPlatformId`, `LandingDownloadContractError`, timestamp/path rules, and `resolveLatestLandingDownload` as superseded owners.

- [ ] **Step 4: Implement the reusable copy function and distribution CLI**

Create `script/build-landing-dist.ts` with:

```ts
#!/usr/bin/env bun

import { $ } from "bun"
import { cp, mkdir, readdir, rm, stat } from "node:fs/promises"
import path from "node:path"
import { landingWindowsDownload, type LandingWindowsDownload } from "../packages/web/src/lib/landing-download"

export type LandingArtifactCopyResult = {
  sourceDirectory: string
  destinationDirectory: string
  installerPath: string
  files: Array<{ relativePath: string; bytes: number }>
}

async function inventory(root: string, relativeRoot = ""): Promise<Array<{ relativePath: string; bytes: number }>> {
  const directory = path.join(root, relativeRoot)
  const entries = await readdir(directory, { withFileTypes: true })
  const files: Array<{ relativePath: string; bytes: number }> = []
  for (const entry of entries) {
    const relativePath = path.join(relativeRoot, entry.name)
    if (entry.isDirectory()) files.push(...await inventory(root, relativePath))
    if (entry.isFile()) {
      files.push({ relativePath: relativePath.replaceAll("\\", "/"), bytes: (await stat(path.join(root, relativePath))).size })
    }
  }
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

export async function copyLandingWindowsArtifacts(
  repoRoot: string,
  contract: LandingWindowsDownload = landingWindowsDownload,
): Promise<LandingArtifactCopyResult> {
  const sourceDirectory = path.resolve(repoRoot, contract.sourceDirectory)
  const destinationDirectory = path.resolve(repoRoot, contract.destinationDirectory)
  const sourceDirectoryStat = await stat(sourceDirectory)
  if (!sourceDirectoryStat.isDirectory()) throw new Error(`Landing Windows artifact source is not a directory: ${sourceDirectory}`)
  const sourceFiles = await inventory(sourceDirectory)
  if (sourceFiles.length === 0) throw new Error(`Landing Windows artifact source is empty: ${sourceDirectory}`)
  const installerSource = path.join(sourceDirectory, contract.installerFileName)
  const installerStat = await stat(installerSource)
  if (!installerStat.isFile() || installerStat.size === 0) throw new Error(`Landing Windows setup executable is empty: ${installerSource}`)
  await rm(destinationDirectory, { recursive: true, force: true })
  await mkdir(path.dirname(destinationDirectory), { recursive: true })
  await cp(sourceDirectory, destinationDirectory, { recursive: true, force: true })
  const destinationFiles = await inventory(destinationDirectory)
  if (JSON.stringify(destinationFiles) !== JSON.stringify(sourceFiles)) {
    throw new Error("Landing Windows artifact copy does not match the source inventory")
  }
  return {
    sourceDirectory,
    destinationDirectory,
    installerPath: path.join(destinationDirectory, contract.installerFileName),
    files: destinationFiles,
  }
}

if (import.meta.main) {
  const repoRoot = path.resolve(import.meta.dir, "..")
  const sourceDirectory = path.resolve(repoRoot, landingWindowsDownload.sourceDirectory)
  await $`bun ./script/check-release-assets.ts overlay --dir ${sourceDirectory} --platform windows-x64 --version ${landingWindowsDownload.version} --require-bundle`.cwd(repoRoot)
  await $`bun run --cwd packages/web build`.cwd(repoRoot)
  const result = await copyLandingWindowsArtifacts(repoRoot)
  console.log(JSON.stringify(result, null, 2))
}
```

- [ ] **Step 5: Expose the root distribution command**

Add this script beside the existing build/package entries in root `package.json`:

```json
"build:landing-dist": "bun run script/build-landing-dist.ts"
```

- [ ] **Step 6: Run the focused contract to green**

Run:

```powershell
bun test packages/opencorvus/test/script/landing-download-contract.test.ts
```

Expected: two passing positive tests, including exact catalog output and complete artifact inventory/byte equality.

- [ ] **Step 7: Commit the static distribution contract**

Stage only these paths and commit:

```powershell
git add -- package.json script/build-landing-dist.ts packages/web/src/lib/landing-download.ts packages/opencorvus/test/script/landing-download-contract.test.ts
git commit -m "dsw-33987 assemble landing dist from windows artifacts"
```

### Task 2: Replace the modal with the inline bilingual Windows download section

**Files:**
- Modify: `packages/web/src/content/landing.ts:50-64,130-145,303-317`
- Modify: `packages/web/src/components/Lander.astro:10-16,52-65,108-109,294-347,350-437,843-1030`

**Interfaces:**
- Consumes: `landingWindowsDownload.publicRelativePath`, `.version`, `.architecture`, and `.packageType` from Task 1.
- Produces: `downloadHref = `${import.meta.env.BASE_URL}${landingWindowsDownload.publicRelativePath}`` in Astro frontmatter.
- Produces: `LandingContent.download` fields `trigger`, `eyebrow`, `title`, `description`, `platform`, `architecture`, `packageType`, `versionLabel`, and `action`.

- [ ] **Step 1: Replace dialog copy with exact inline-section copy**

Change the `LandingContent.download` shape to:

```ts
download: {
  trigger: string
  eyebrow: string
  title: string
  description: string
  platform: string
  architecture: string
  packageType: string
  versionLabel: string
  action: string
}
```

Use this English copy:

```ts
download: {
  trigger: "Download",
  eyebrow: "OpenCorvus Desktop",
  title: "Download OpenCorvus for Windows",
  description: "Install the complete desktop client and start working with your own repository in a local, durable project context.",
  platform: "Windows 10/11",
  architecture: "x64",
  packageType: "EXE installer",
  versionLabel: "Version",
  action: "Download Windows x64",
}
```

Use this Simplified Chinese copy:

```ts
download: {
  trigger: "一键下载",
  eyebrow: "OpenCorvus 桌面端",
  title: "下载 Windows 版 OpenCorvus",
  description: "安装完整桌面客户端，把自己的代码仓库放进一个可持续推进、随时可回看的本地项目上下文。",
  platform: "Windows 10/11",
  architecture: "x64",
  packageType: "EXE 安装程序",
  versionLabel: "版本",
  action: "下载 Windows x64 安装包",
}
```

- [ ] **Step 2: Convert the hero button into a native in-page anchor**

Replace the dialog button with:

```astro
<a class="primary-button" href="#download">
  {content.download.trigger}<Icon name="download" size="1rem" />
</a>
```

This keeps the existing primary visual hierarchy while removing dialog ownership and asynchronous activation.

- [ ] **Step 3: Render the inline Windows section before `#features`**

In frontmatter, replace the platform-array import with:

```ts
import { landingWindowsDownload } from "../lib/landing-download"

const downloadHref = `${import.meta.env.BASE_URL}${landingWindowsDownload.publicRelativePath}`
```

At the start of `.landing-main`, add:

```astro
<section id="download" class="download-section" aria-labelledby="landing-download-title">
  <div class="section-wrap download-layout">
    <div class="download-copy">
      <p class="section-kicker">{content.download.eyebrow}</p>
      <h2 id="landing-download-title">{content.download.title}</h2>
      <p>{content.download.description}</p>
    </div>
    <article class="download-card">
      <div class="download-card-heading">
        <span class="download-platform">Windows</span>
        <span class="download-version">{content.download.versionLabel} {landingWindowsDownload.version}</span>
      </div>
      <dl class="download-facts">
        <div><dt>OS</dt><dd>{content.download.platform}</dd></div>
        <div><dt>ARCH</dt><dd>{content.download.architecture}</dd></div>
        <div><dt>PACKAGE</dt><dd>{content.download.packageType}</dd></div>
      </dl>
      <a class="download-button" href={downloadHref} download>
        <span>{content.download.action}</span><Icon name="download" size="1rem" />
      </a>
    </article>
  </div>
</section>
```

`OS` means Operating System (操作系统), and `ARCH` means processor architecture (处理器架构); keep the visible abbreviations compact while this plan records their full meanings.

- [ ] **Step 4: Delete the superseded dialog and runtime download script**

Delete the entire `landing-download-dialog` block. In the client script, retain only the existing image-preview dialog logic at lines 353-366 and delete the import, dialog query, platform loading, network fetch, recommendation detection, generated anchor, backdrop close, and focus-restoration code at lines 351 and 368-437.

Delete the complete `.download-dialog` through `.download-option[data-download-error-state] .download-option-action` style block. Add section-local styles for `.download-section`, `.download-layout`, `.download-copy`, `.download-card`, `.download-card-heading`, `.download-platform`, `.download-version`, `.download-facts`, and `.download-button`, reusing the existing `--green`, `--ink`, `--muted`, `--line`, and section-wrap tokens.

- [ ] **Step 5: Run static non-UI validation**

Run:

```powershell
bun run --cwd packages/web check
bun run --cwd packages/web build
```

Expected: Astro completes with zero errors, and both `/docs/` and `/docs/zh-cn/` static routes are generated. Do not inspect UI source with test assertions and do not run a UI test suite.

- [ ] **Step 6: Commit the inline landing section**

Stage only the component/content files and commit:

```powershell
git add -- packages/web/src/content/landing.ts packages/web/src/components/Lander.astro
git commit -m "dsw-33987 show inline windows download"
```

### Task 3: Assemble and verify the real deployable distribution

**Files:**
- Generated: `packages/web/dist/**`
- Source artifact input: `packages/overlay/dist-artifacts/windows-x64/**`

**Interfaces:**
- Consumes: root `build:landing-dist` command and current Windows artifact directory.
- Produces: a complete deployable `packages/web/dist` with `downloads/windows-x64/**` and a direct current-version setup executable.

- [ ] **Step 1: Record the existing native artifact inventory without rebuilding**

Run:

```powershell
Get-ChildItem -LiteralPath packages/overlay/dist-artifacts/windows-x64 -File |
  Sort-Object Name |
  Select-Object Name,Length,LastWriteTime
```

Expected: the executable, NSIS setup executable, and MSI package are present; the setup filename contains `0.0.30-beta` and every file length is greater than zero.

- [ ] **Step 2: Build the promotional distribution once**

Run:

```powershell
bun run build:landing-dist
```

Expected: existing release assets validate, Astro generates the site, the full Windows directory is copied, and the command prints the matching destination inventory. It must not print or execute a native build command.

- [ ] **Step 3: Compare real source and destination inventories**

Run this read-only comparison:

```powershell
$sourceRoot = (Resolve-Path packages/overlay/dist-artifacts/windows-x64).Path
$distRoot = (Resolve-Path packages/web/dist/downloads/windows-x64).Path
$sourceInventory = Get-ChildItem -LiteralPath $sourceRoot -Recurse -File | ForEach-Object {
  [pscustomobject]@{ Path = $_.FullName.Substring($sourceRoot.Length + 1); Bytes = $_.Length }
}
$distInventory = Get-ChildItem -LiteralPath $distRoot -Recurse -File | ForEach-Object {
  [pscustomobject]@{ Path = $_.FullName.Substring($distRoot.Length + 1); Bytes = $_.Length }
}
Compare-Object ($sourceInventory | Sort-Object Path | ConvertTo-Json -Compress) ($distInventory | Sort-Object Path | ConvertTo-Json -Compress)
```

Expected: no comparison rows, meaning exact relative paths and byte sizes match.

- [ ] **Step 4: Re-run focused and static checks against the assembled state**

Run:

```powershell
bun test packages/opencorvus/test/script/landing-download-contract.test.ts
bun run --cwd packages/web check
```

Expected: focused positive contracts and Astro type/static analysis pass.

### Task 4: Perform real desktop visual and download acceptance

**Files:**
- Create: `specs/artifacts/landing-windows-download-en.png`
- Create: `specs/artifacts/landing-windows-download-zh-cn.png`
- Modify when visual evidence requires correction: `packages/web/src/components/Lander.astro`

**Interfaces:**
- Consumes: the assembled `packages/web/dist` from Task 3.
- Produces: manually reviewed English/Chinese screenshots and observed static setup-executable requests.

- [ ] **Step 1: Start the built Astro preview with Node**

From `packages/web`, run the installed Astro CLI through Node on an available port:

```powershell
node ../../node_modules/astro/astro.js preview --host 127.0.0.1 --port 4321
```

Use a hidden background process if a persistent preview is required. Do not launch Playwright through Bun.

- [ ] **Step 2: Inspect the English page in a visible browser**

Open `http://127.0.0.1:4321/docs/` in the real browser. At a desktop viewport:

1. Confirm the inline download section is visible in normal page flow.
2. Activate the hero download link and confirm the real page scrolls to `#download`.
3. Inspect heading hierarchy, version, Windows 10/11, x64, EXE metadata, focus ring, and spacing.
4. Activate the download anchor and observe a request whose path is `/docs/downloads/windows-x64/OpenCorvus_0.0.30-beta_x64-setup.exe`; cancel the large transfer after the real static request is established.
5. Capture `specs/artifacts/landing-windows-download-en.png` and personally inspect it.

- [ ] **Step 3: Inspect the Simplified Chinese page in a visible browser**

Open `http://127.0.0.1:4321/docs/zh-cn/` and repeat the hero-scroll, keyboard-focus, direct-download request, clipping, and spacing inspection. Capture `specs/artifacts/landing-windows-download-zh-cn.png` and personally inspect it.

- [ ] **Step 4: Correct and repeat any visual defect**

If either screenshot shows weak hierarchy, clipping, excessive empty space, inconsistent alignment, or illegible metadata, update only section-local styles in `Lander.astro`, rebuild with `bun run build:landing-dist`, and repeat both visible screenshots. Do not create screenshot baselines, Playwright test files, fixtures, or pass/fail scripts.

### Task 5: Record evidence, run final review, and deliver

**Files:**
- Modify: `specs/records/2026-08/2026-08-04-static-landing-windows-download-implementation-plan.md`
- Modify if needed: `specs/README.md`
- Modify if needed: `specs/records/2026-08/README.md`

**Interfaces:**
- Consumes: focused/static/docs results, real artifact inventories, preview URLs, request paths, screenshots, and source review.
- Produces: final evidence, scoped commits, and pushed legacy remote branch.

- [ ] **Step 1: Run required documentation checks**

Run:

```powershell
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
```

Expected: all three files pass. If an unrelated full-repository scan times out under concurrent load, preserve its exact output and rerun without changing code; only a passing rerun counts as acceptance.

- [ ] **Step 2: Perform a second source/distribution review**

Review the exact task diff and generated distribution facts:

```powershell
git diff --check
git diff -- package.json script/build-landing-dist.ts packages/web/src/lib/landing-download.ts packages/web/src/content/landing.ts packages/web/src/components/Lander.astro packages/opencorvus/test/script/landing-download-contract.test.ts
Get-ChildItem -LiteralPath packages/web/dist/downloads/windows-x64 -Recurse -File | Sort-Object FullName | Select-Object FullName,Length
```

Confirm the catalog is the only filename/path owner, the assembler never invokes native packaging, runtime code performs no package request, the complete Windows directory is present, and unrelated Overlay edits remain outside the staged diff.

- [ ] **Step 3: Append concrete implementation evidence to this plan**

Record exact test counts, Astro results, source/destination inventories, generated installer path and size, visible preview URLs, observed static request, screenshots personally inspected, corrections made, and second-review verdict. Do not call mocked data or static source inspection visual acceptance.

- [ ] **Step 4: Commit the evidence and screenshots**

Stage only the plan, indexes, and two screenshots, then commit:

```powershell
git add -- specs/README.md specs/records/2026-08/README.md specs/records/2026-08/2026-08-04-static-landing-windows-download-implementation-plan.md specs/artifacts/landing-windows-download-en.png specs/artifacts/landing-windows-download-zh-cn.png
git commit -m "dsw-33987 record landing windows distribution evidence"
```

- [ ] **Step 5: Reconcile the remote and push legacy remote**

Fetch `legacy-remote/work-lcx-v0.0.30beta`, confirm the branch relationship, integrate any remote commits without overwriting the unrelated dirty Overlay work, and push normally:

```powershell
git fetch legacy-remote work-lcx-v0.0.30beta
git rev-list --left-right --count HEAD...legacy-remote/work-lcx-v0.0.30beta
git push legacy-remote work-lcx-v0.0.30beta
```

Do not use `--no-verify`. If the pre-push Overlay internationalization check still observes the unrelated in-progress panel revision mismatch, report that exact external working-tree blocker and retry after its owner finishes; do not edit, stash, reset, or discard that work.

## Implementation evidence

- The static distribution contract was implemented as the only download source: `packages/overlay/dist-artifacts/windows-x64` is copied recursively into `packages/web/dist/downloads/windows-x64`; no native Windows or macOS packaging command is invoked by `build:landing-dist`.
- Test-driven development evidence: the focused contract test first failed with `Static Windows artifact copy is not implemented`, then passed after implementing the directory assembler. Final result: `1 pass`, `0 fail`, `2 expect() calls`.
- `bun run build:landing-dist` completed successfully and built 105 static pages. Its final artifact inventory contains exactly:
  - `OpenCorvus_0.0.30-beta_x64_en-US.msi` — 210,460,672 bytes.
  - `OpenCorvus_0.0.30-beta_x64-setup.exe` — 209,913,873 bytes.
  - `opencorvus-overlay.exe` — 219,023,872 bytes.
- An independent source/destination comparison found `3 files, 639398417 bytes` on both sides with no path or size difference. A temporary static server returned HTTP `200 OK`, `Content-Type: application/x-msdownload`, and `Content-Length: 209913873` for `/downloads/windows-x64/OpenCorvus_0.0.30-beta_x64-setup.exe`.
- `bun run --cwd packages/web check` completed with `0 errors`, `0 warnings`, and one pre-existing unused-variable hint in `qa/dedupe-lead.cjs`.
- Required documentation validation passed: `70 pass`, `0 fail`, `1188 expect() calls` across `historical-docs-links.test.ts`, `document-health.test.ts`, and `product-docs-single-source.test.ts`.
- Visible browser review used the real running landing page at `http://127.0.0.1:9999/docs/` and `http://127.0.0.1:9999/docs/zh-cn/`. The hero links scrolled to `#download`; the inline section showed Windows 10/11, x64, EXE, version `0.0.30-beta`, and the direct installer action without a dialog. The English action emitted a real browser download event.
- Browser review exposed one real deployment-path defect: concatenating `BASE_URL` and the relative path produced `/docsdownloads/...`. The cause was missing path separation, and the single URL owner now emits `/docs/downloads/windows-x64/OpenCorvus_0.0.30-beta_x64-setup.exe`.
- Screenshots were personally inspected at `specs/artifacts/landing-windows-download-en.png` and `specs/artifacts/landing-windows-download-zh-cn.png`. Both show the download section fully visible, readable metadata, strong action hierarchy, and no clipping; no screenshot baseline or UI automation test was created.
- Second review verdict: the catalog remains the only filename/path owner, the assembler only validates/builds/copies existing files, runtime code performs no release-history request, macOS is absent, and unrelated Overlay work was not staged or altered.

## Plan self-review

- Spec coverage: existing-directory-only input, no rebuild, complete copy, current-version NSIS link, inline English/Chinese UI, macOS omission, build command, positive tests, real artifact verification, visual screenshots, second review, commits, and legacy remote push all have exact tasks.
- Placeholder scan: every implementation, test, command, copy path, public path, user-visible string, acceptance action, and commit is concrete.
- Type consistency: `LandingWindowsDownload`, `landingWindowsDownload`, `LandingArtifactCopyResult`, and `copyLandingWindowsArtifacts` use identical names and fields across test, producer, assembler, and Astro consumer.
- Test boundary: automated checks cover catalog/filesystem/static contracts only. No DOM, TSX, HTML, CSS, i18n string, snapshot, browser fixture, or screenshot assertion is added or run.
- Worktree safety: all staging commands enumerate exact task files, and the known unrelated Overlay edits remain untouched.
