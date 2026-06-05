# Overlay package size optimization - 2026-06-05

## Evidence

The Windows overlay release binary is 282.20 MiB at `packages/overlay/src-tauri/target/release/opencorvus-overlay.exe`.
The Vite frontend payload is about 2.5 MiB, and `packages/overlay/src-tauri/resources` is empty.

The binary size comes from `packages/overlay/src-tauri/build.rs` generating `embedded_sidecar.rs` with one `include_bytes!` entry per file under `packages/opencorvus/dist/opencorvus-overlay-server-windows-x64`.
That sidecar directory contains the 123.77 MiB `opencorvus.exe`, the 88.00 MiB Browser Model Context Protocol Node runtime, and packaged runtime `node_modules`.

## Call Points

| Surface | Current behavior | Change |
| --- | --- | --- |
| `packages/overlay/src-tauri/build.rs` `write_embed_module` | Emits every sidecar file as a raw `include_bytes!` item. | Emit one gzip-compressed tar archive plus a file manifest. |
| `packages/overlay/src-tauri/src/main.rs` `ensure_embedded_server_path` | Copies every embedded byte slice to app-local-data. | Validate the manifest, unpack the embedded archive when the extracted payload is missing or incomplete. |
| `packages/overlay/src-tauri/src/main.rs` embedded payload tests | Assert manifest entries and byte presence. | Assert manifest entries, sizes, archive presence, and compression on real payloads. |
| `packages/overlay/src-tauri/Cargo.toml` | No archive decode dependency. | Add mature `flate2` and `tar` crates for archive creation and extraction. |

## Non-goals

- Do not remove browser automation, Playwright, native PTY, Sharp, or watcher runtime files.
- Do not introduce an alternate external sidecar source or network download.
- Do not change the overlay frontend bundle.

## Acceptance

- `cargo test --manifest-path packages/overlay/src-tauri/Cargo.toml`
- `bun test packages/overlay/test/overlay-artifact-names.test.ts`
- Rebuild overlay and compare `packages/overlay/dist/opencorvus-overlay-windows-x64/opencorvus-overlay.exe` size against the current 282.20 MiB baseline.
