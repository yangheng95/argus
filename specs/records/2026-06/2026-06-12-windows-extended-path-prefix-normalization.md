# Windows Extended Path Prefix Normalization

Date: 2026-06-12

## Problem

Windows long-path support can surface Node realpaths as `\\?\D:\...`.
That path form is valid for Windows filesystem APIs, but it is not a safe
module specifier for frontend bundlers. When OpenCorvus exposes it through
tool output, permission metadata, or path comparison, build systems can later
try to resolve imports such as:

```text
\\?\D:\...\node_modules\.pnpm\...\scrollbar.css
```

Webpack-style resolvers then report `Module not found: Can't resolve '\\?\D:\...'`.

## Call-Site Evidence

Commands used before changing the design:

```text
rg -n "toNamespacedPath|\\\\\?\\|MAX_PATH|longPath|long path" packages specs docs -g "*.ts" -g "*.tsx" -g "*.md"
rg -n "Filesystem\.normalizePath|Filesystem\.resolve|windowsPath\(|contains\(|realpathSync\.native" packages/opencorvus/src packages/opencorvus/test -g "*.ts"
rg -n "fs\.realpath|realpathSync|path\.toNamespacedPath" packages/opencorvus/src packages/opencorvus/test -g "*.ts"
```

Relevant write/read boundary:

| Surface                         | Decision                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `Filesystem.normalizePath`      | Strip Windows extended path prefixes after `realpathSync.native`.                                                               |
| `Filesystem.resolve`            | Continue to use the single filesystem path boundary, now inheriting prefix stripping through `windowsPath` and `normalizePath`. |
| `Filesystem.windowsPath`        | Strip `\\?\` and `\\?\UNC\` before Git Bash / Cygwin / WSL mount translation.                                                   |
| `Filesystem.contains`           | Compare paths after the same extended-prefix normalization so namespace and regular forms do not diverge.                       |
| `BashTool.resolveStaticPathArg` | No separate implementation; it calls `Filesystem.windowsPath(real)` and inherits the common normalization.                      |

## Decision

Do not introduce a long-path gate, fallback build mode, or resolver-specific
workaround. Treat `\\?\` as an OS/Node boundary detail and remove it at the
single filesystem utility layer before paths are compared, displayed, or passed
to child toolchains.

## Tests

Add focused unit coverage for:

- `Filesystem.normalizeWindowsPath` converting `\\?\C:\...` to `C:\...`.
- `Filesystem.normalizeWindowsPath` converting `\\?\UNC\server\share\...` to
  `\\server\share\...`.
- `Filesystem.windowsPath` inheriting that conversion on mocked `win32`.
- `Filesystem.contains` treating regular and extended-prefix paths as the same
  tree on mocked `win32`.
