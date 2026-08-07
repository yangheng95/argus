# Landing Distribution Artifact Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make client packaging into `packages/overlay/dist-artifacts` the only prerequisite for a version-correct, standardized promotional `dist` and `dist.zip`.

**Architecture:** A strict filesystem discovery constructor projects the three current client artifacts into one shared landing download catalog. Astro renders that catalog, the builder copies the selected bytes under standardized names, and `archiver` packages the completed dist tree.

**Tech Stack:** Bun, TypeScript, Node filesystem/path/stream APIs, Astro, archiver 7, Bun test.

## Global Constraints

- Public packages are named `OpenCorvus_<version>_<platform>.<suffix>` with `windows-x64.exe`, `darwin-arm64.tar.gz`, and `linux-x64.deb` endings.
- `packages/overlay/dist-artifacts` is the only version and binary source; no package-manifest fallback or native rebuild is allowed.
- Each platform must expose exactly one canonical installer match; selected installers must be non-empty and expose one identical version. Non-installer client artifacts may coexist in the directories.
- `build:landing-dist` must replace both `packages/web/dist` and `packages/web/dist.zip`.
- Automated tests cover filesystem and archive contracts only; no UI automated test may be added, changed, or run.
- Real-page acceptance uses Node-backed browser tooling and `http://localhost:9999`.
- Task commits use the `dsw-33987` prefix and push to `myhexin/v0.0.30beta` without bypassing hooks.

## Recall

The user's first request requires rebuilding the promotional dist from the latest installers with standardized filenames. The follow-up makes future version upgrades part of the acceptance contract: after client packaging populates `packages/overlay/dist-artifacts`, running the landing build alone must publish correct links and files. Read sources, prior landing download specs, repository grep, artifact magic, current Git status, and remote baseline are recorded in `2026-08-05-landing-dist-artifact-discovery-design.md`. The working tree contains the user's pre-existing untracked `packages/web/dist.zip`; the task is explicitly authorized to replace that deliverable, while unrelated files remain untouched. No independent agent feedback exists because delegation is not authorized.

---

### Task 1: Replace stale version synthesis with artifact discovery

**Files:**
- Modify: `packages/opencorvus/test/script/landing-download-contract.test.ts`
- Modify: `packages/web/src/lib/landing-download.ts`

**Interfaces:**
- Produces: `discoverLandingBinaryDownloads(repoRoot: string): LandingBinaryDownload[]`.
- Produces: each result's `sourceFileName`, `downloadFileName`, `sourceDirectory`, `destinationDirectory`, `version`, `publicRelativePath`, and display metadata.

- [ ] Rewrite the focused positive fixture around version `0.0.31-beta`, the three current source filename shapes, and representative non-installer siblings; assert unique canonical installer selection, standardized output names, and one shared version.
- [ ] Run `bun test packages/opencorvus/test/script/landing-download-contract.test.ts` and retain the expected initial contract failure.
- [ ] Implement the platform-definition abstraction and strict discovery constructor; validate exact file identity, size, version convergence, and Debian archive identity.
- [ ] Update `Lander.astro` to call the discovery constructor during Astro generation instead of importing an eager package-manifest catalog.
- [ ] Run the focused test to green.

### Task 2: Copy standardized packages and build the ZIP deliverable

**Files:**
- Modify: `script/build-landing-dist.ts`
- Modify: `package.json`
- Modify: `bun.lock`

**Interfaces:**
- Consumes: `discoverLandingBinaryDownloads(repoRoot)`.
- Produces: `copyLandingBinaryArtifacts(repoRoot, contracts)` with one exact standardized file per platform.
- Produces: `createLandingDistArchive(repoRoot)` returning the completed `packages/web/dist.zip` path and byte size.

- [ ] Extend the focused positive test to assert source-to-standard-name copies, exact byte sizes, and a ZIP containing the standardized package entries.
- [ ] Run the focused test and retain the expected copy/archive contract failure.
- [ ] Replace recursive directory copies and the stale Windows-only release check with exact selected-file copies and byte verification.
- [ ] Add direct `archiver@7.0.1` and type support, then implement cross-platform ZIP creation with a temporary sibling archive followed by atomic replacement.
- [ ] Make the root landing build run discovery, Astro, exact copies, ZIP creation, and structured result output in that order.
- [ ] Run the focused test to green.

### Task 3: Build and verify the real upgraded distribution

**Files:**
- Generated: `packages/web/dist/**`
- Generated/replaced: `packages/web/dist.zip`

**Interfaces:**
- Consumes: the real three `0.0.31-beta` packages already present under `packages/overlay/dist-artifacts`.
- Produces: version-correct static pages, three standardized packages, and one deployable ZIP.

- [ ] Run `bun run build:landing-dist` once; do not run a native client build.
- [ ] Verify the three generated relative paths and exact source/destination byte sizes.
- [ ] List `packages/web/dist.zip` and verify it contains the same standardized download paths under `dist/downloads/`.
- [ ] Run `bun run --cwd packages/web check` and the focused contract test.

### Task 4: Perform real-page visual and download acceptance

**Files:**
- Create: `specs/artifacts/landing-dist-downloads-0.0.31-beta-en.png`
- Create: `specs/artifacts/landing-dist-downloads-0.0.31-beta-zh-cn.png`

**Interfaces:**
- Consumes: the built `packages/web/dist`.
- Produces: manually reviewed desktop screenshots and real request evidence for all three standardized package URLs.

- [ ] Use the `mirror-project` startup flow to serve the real built site at `http://localhost:9999`.
- [ ] Open the English page in the visible browser, inspect the four access cards, and establish successful real requests for Windows, Darwin, and Linux downloads without retaining full duplicate downloads.
- [ ] Repeat on the Chinese page and capture both goal-scoped screenshots.
- [ ] Personally inspect the screenshots; if version/link changes expose clipping or incorrect metadata, correct the real page and repeat the build and review.

### Task 5: Record evidence, review, commit, and push

**Files:**
- Modify: this implementation plan
- Modify: `specs/README.md`
- Modify: `specs/records/2026-08/README.md`

**Interfaces:**
- Produces: exact verification evidence, a second review verdict, scoped commits, and the pushed git-cc branch.

- [ ] Run `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts`.
- [ ] Run `git diff --check`, inspect the task diff, generated package inventory, ZIP entries, and Git status, and confirm no unrelated file is staged.
- [ ] Append exact build, test, size, URL, screenshot, and second-review evidence to this plan.
- [ ] Commit implementation and evidence with `dsw-33987` subjects.
- [ ] Fetch/reconcile `myhexin/v0.0.30beta`, push normally, and confirm local/remote equality.

## Plan self-review

- Spec coverage: discovery, version convergence, standard names, real copies, ZIP output, page links, non-UI tests, visible browser acceptance, documentation, review, commits, and push each have an owning task.
- Placeholder scan: all source patterns, output names, commands, files, URLs, and acceptance checks are explicit.
- Type consistency: discovery produces the exact contract consumed by Astro and both builder functions.
- UI boundary: the focused test never reads or asserts Astro, HTML, CSS, localization copy, DOM, screenshots, or interactions.
