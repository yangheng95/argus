# Packaged Startup Handoff Repair

## Goal

Repair the Windows desktop client's first-launch progress surface so it shows
stable, readable backend preparation copy and reliably hands control to the
bundled application after backend health is confirmed.

## Recall

| Item | Evidence |
| --- | --- |
| User request | Replace rapidly changing file names above first-launch backend progress with readable copy; after backend compilation completes, enter the normal client instead of remaining at 100%. |
| Acceptance criteria | Extraction progress does not reveal archive file names; a `ready` progress event loads the built Solid application in the packaged client. |
| Root cause | `unpack_embedded_payload` emits `Extracting <relative path>` for every archive entry. The bootstrap adds a module script whose literal source is `/main.tsx`; Vite leaves that dynamically assigned value unchanged, while production emits only `assets/index-<hash>.js`. The ready event is received, but the requested module does not exist in the packaged asset set. |
| Hard constraints | One startup surface and one Tauri window; actual byte-derived progress; no fallback/gate/state-machine path; no UI automated tests; real packaged-client visual review is required. |
| Sources read | `AGENTS.md`, `docs/packaging.md`, `packages/overlay/src/index.html`, `packages/overlay/dist-vite/index.html`, `packages/overlay/vite.config.ts`, `packages/overlay/src-tauri/src/main.rs`, and `specs/records/2026-08/2026-08-03-packaged-startup-progress.md`. |
| Whole-repository search | `rg` over Overlay and core sources for startup progress, backend readiness, compilation, and startup bootstrap found the one Rust progress producer and the one HTML startup consumer. |
| Independent agent feedback | None; the user did not request delegation. |

## Design

- The Rust payload extractor continues to report actual cumulative bytes, but
  uses one stable phrase: `Preparing embedded backend`.
- The HTML bootstrap uses a literal dynamic module import in an inline module
  script. Vite resolves that import during production build to the hashed
  application entrypoint, while the readiness event remains the sole owner of
  when that import happens.
- No new UI automation is introduced. Verification is a real Vite build,
  packaged-client cold launch, screenshot inspection of progress and normal
  application handoff, plus existing non-UI build checks.

## Verification

- Pending implementation: inspect the emitted `dist-vite/index.html` to prove
  the production entrypoint is hashed rather than `/main.tsx`.
- Pending visual acceptance: launch the freshly packaged Windows client after
  clearing only its isolated test payload directory and inspect screenshots of
  extraction and post-ready handoff.
