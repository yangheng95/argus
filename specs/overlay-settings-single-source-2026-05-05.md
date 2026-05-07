# Overlay Settings Single Source Plan

## Problem

The desktop overlay currently persists the same settings through two stores:

- browser `localStorage`
- Tauri `overlay_settings_load` / `overlay_settings_save`, backed by `overlay.json`

Startup reads both and lets the later native read overwrite the browser read. Saves write both. This violates the single-source rule and can hide schema gaps because fields not serialized by Rust remain preserved only in browser storage.

## Target

- Tauri host: `overlay.json` is the only persistent source for overlay shell settings.
- Browser / VS Code host: browser storage is the only persistent source for overlay shell settings.
- Business code uses one settings persistence API and does not read both sources.
- Project/runtime config stays out of overlay shell settings.

## Implementation

1. Move browser-storage serialization into a host persistence helper.
2. Make `loadSettings()` ask the active host transport for one settings object.
3. Make `saveSettings()` ask the active host transport to persist one settings object.
4. Teach the Tauri Rust settings schema every overlay-shell field that must round-trip through `overlay.json`.
5. Remove the boot-time inline `oc_theme` localStorage read.
6. Add targeted tests that stale localStorage cannot override native Tauri settings and Tauri saves do not write browser storage.
