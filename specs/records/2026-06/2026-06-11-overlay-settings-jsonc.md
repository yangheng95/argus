# Overlay settings JSONC persistence

## Request

Persist overlay connection settings in a JSONC file.

## Call sites checked

| Surface                                                                    | Current behavior                                            | Change                                                                |
| -------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------- |
| `packages/overlay/src-tauri/src/main.rs` `overlay_settings_path/load/save` | Native desktop settings use `overlay.json` and `serde_json` | Use `overlay.jsonc`, parse JSONC text, keep stable pretty JSON output |
| `packages/overlay/src/store/settings.ts` `settings.load/save`              | Calls native `settings.load` / `settings.save`              | No interface change                                                   |
| `packages/overlay/src/services/tauri-transport.ts`                         | Maps native commands to Tauri commands                      | No interface change                                                   |
| `packages/overlay/src/services/overlay-settings-storage.ts`                | Browser fallback uses `localStorage` keys                   | No desktop JSONC write path here                                      |
| `packages/web/src/content/docs/**/overlay/overview.mdx`                    | Documents `.opencorvus/overlay.json`                        | Update docs to `.opencorvus/overlay.jsonc`                            |

## Decision

The single source for desktop overlay connection settings becomes the Tauri app config file `overlay.jsonc`. It must not be written to project `opencorvus.jsonc`: server URL, username, and password are needed before any backend connection exists, so a server-side config route cannot be the source of truth.

Provider API keys remain backend credentials in `auth.json`; this change only covers overlay connection settings.

## Verification

Add Rust unit coverage for:

- the filename is `overlay.jsonc`
- JSONC input with comments and trailing commas parses into `OverlaySettings`
- saved text round-trips through the same parser

## Codex review feedback

Full `cargo test` also exposed an existing embedded payload assertion that still expected npm's nested optional dependency path for `@parcel/watcher-*`. The generated payload on this workspace uses Bun's direct sibling package path (`node_modules/@parcel/watcher-win32-x64/package.json`). The test now checks the actual embedded runtime path while preserving the same requirement: wrapper plus native watcher package must be bundled.
