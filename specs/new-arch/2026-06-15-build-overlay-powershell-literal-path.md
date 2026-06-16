# Build overlay PowerShell literal path

## Problem

`packages/overlay/script/build-overlay.ts` has a Windows-only fallback for
removing a locked overlay binary. It interpolates `builtOverlay` into a
PowerShell single-quoted string:

```powershell
Remove-Item -Force -Path '<path>'
```

Windows checkout paths can contain `'`, and `-Path` also treats wildcard
characters as patterns. This makes the fallback unreliable exactly when the
normal Node removal path has already failed.

## Call-point Sweep

| Call point | Decision |
| --- | --- |
| `build-overlay.ts` normal `fs.rm` | Keep. |
| `build-overlay.ts` rename-then-delete fallback | Keep. |
| `build-overlay.ts` PowerShell fallback | Pass `builtOverlay` as a separate PowerShell argument and use `-LiteralPath $args[0]`. |
| `packages/overlay/test` | Add a static regression test proving the fallback does not interpolate the path into `-Command`. |

## Verification

- Static unit test for the PowerShell command contract.
- Overlay typecheck.
