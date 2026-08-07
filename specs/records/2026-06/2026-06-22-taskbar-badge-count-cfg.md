# Taskbar Badge Count CFG

Date: 2026-06-22
Status: Verified

## Acronyms

- CFG: Conditional compilation configuration, the Rust `#[cfg(...)]` mechanism.
- GUI: Graphical User Interface, the desktop overlay window and taskbar surface.
- Tauri: The desktop application runtime used by the overlay shell.

## Task Definition

Remove the Windows `cargo check` dead-code warning for `badge_count_value`
without deleting the non-Windows badge count behavior or the Windows taskbar
overlay icon behavior.

## Recall

| Source                                                      | Constraint carried forward                                                                                                                                                  |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                                 | Fix tool/build warnings at the source, avoid blind deletion, and keep tests.                                                                                                |
| `2026-06-21-frontend-design-research-adversarial-repair.md` | Recorded `badge_count_value` as a non-blocking overlay build hygiene warning.                                                                                               |
| `src-tauri/src/main.rs` call inventory                      | Windows `overlay_badge_set` uses `set_overlay_icon`; non-Windows `overlay_badge_set` uses `set_badge_count(badge_count_value(count))`; unit tests call `badge_count_value`. |

## Evidence

`cargo check --manifest-path packages/overlay/src-tauri/Cargo.toml` on Windows
reported:

```text
warning: function `badge_count_value` is never used
```

## Decision

Keep `badge_count_value` as the single count-normalization helper for
non-Windows taskbar badge counts, and compile it on Windows only for tests:

```rust
#[cfg(any(not(windows), test))]
fn badge_count_value(...)
```

This is not a fallback. Windows production code already has a separate taskbar
overlay icon path because Tauri's badge count API is not the active Windows
implementation in this file.

## Acceptance

- Windows `cargo check` no longer reports the dead-code warning.
- The existing unit test still proves positive counts are preserved and
  zero/negative counts clear the badge.
- No change to `overlay_badge_set` behavior on Windows or non-Windows.

## Verification

- `RUSTFLAGS=-Dwarnings cargo check --manifest-path packages/overlay/src-tauri/Cargo.toml`
- `cargo test --manifest-path packages/overlay/src-tauri/Cargo.toml badge_count_value`

## Self Review

- The helper is still compiled for non-Windows production and for tests.
- Windows production still uses the taskbar overlay icon path directly.
- No fallback, alternate badge source, or behavior compatibility branch was
  introduced.
