export type BuildFlavor = "cli" | "overlay-server"

export function parseBuildFlavor(argv: string[]): BuildFlavor {
  return argv.includes("--overlay-server") ? "overlay-server" : "cli"
}

export function artifactPackageBaseName(pkgName: string, flavor: BuildFlavor): string {
  if (flavor === "overlay-server") return `${pkgName}-overlay-server`
  return pkgName
}

export function artifactEntrypoints(flavor: BuildFlavor): string[] {
  if (flavor === "overlay-server") return ["./src/overlay-launcher.ts"]
  return ["./src/launcher.ts"]
}

export function artifactExternalModules(): string[] {
  return [
    // Playwright exposes Electron support as an optional runtime path. The
    // packaged server uses Chromium only, so the compiler must not require
    // Electron to be installed just because Playwright's package graph names it.
    "electron",
    // Playwright carries runtime package-relative resolution (browser registry,
    // protocol helpers, and optional BiDi modules). Bun compile must leave it as
    // a packaged node_modules dependency instead of flattening it into the exe.
    "playwright",
    "playwright-core",
    "chromium-bidi",
    // AWS SDK credential providers contain dynamic credential-chain imports
    // that Bun can rewrite into missing intermediate chunks during bundling.
    // Keep the credential chain in packaged node_modules just like browser and
    // native runtime dependencies.
    "@aws-sdk/credential-providers",
    // Native Node packages must resolve from the executable directory's
    // co-located node_modules tree. Bun compile cannot make their platform
    // .node files available through normal package resolution by itself.
    "@parcel/watcher",
    "@parcel/watcher/wrapper",
    "@lydell/node-pty",
    "node-screenshots",
    "sharp",
  ]
}

export function artifactBrowserMcpNodeExternalModules(): string[] {
  return artifactExternalModules()
}

export function artifactSourcemap(): "none" {
  return "none"
}

export function artifactBrowserMcpNodeExecutableName(os = process.platform): string {
  return os === "win32" ? "node.exe" : "node"
}

export function artifactExecutableName(os = process.platform): string {
  return os === "win32" || os.startsWith("windows") ? "opencorvus.exe" : "opencorvus"
}

export function artifactRipgrepExecutableName(os = process.platform): string {
  return os === "win32" || os.startsWith("windows") ? "rg.exe" : "rg"
}

export interface ArtifactNodeRuntimeTarget {
  os: string
  arch: string
  abi?: "musl"
}

export interface ArtifactNodeRuntimeHost {
  platform: string
  arch: string
  // libc is the Linux C standard library implementation: glibc or musl.
  linuxLibc?: "glibc" | "musl"
}

export interface ArtifactRuntimeNodeModule {
  name: string
  runtimeDependencies?: string[]
}

export function artifactHostCanProvideNodeRuntime(
  target: ArtifactNodeRuntimeTarget,
  host: ArtifactNodeRuntimeHost,
): boolean {
  if (target.os !== host.platform || target.arch !== host.arch) return false
  if (target.os !== "linux") return target.abi === undefined
  return (target.abi ?? "glibc") === host.linuxLibc
}

export function artifactRuntimeNodeModules(target: ArtifactNodeRuntimeTarget): ArtifactRuntimeNodeModule[] {
  return [
    { name: "playwright" },
    { name: "playwright-core" },
    { name: "chromium-bidi" },
    { name: "@aws-sdk/credential-providers" },
    { name: "@lydell/node-pty", runtimeDependencies: [nodePtyNativePackageName(target)] },
    { name: "sharp", runtimeDependencies: sharpNativePackageNames(target) },
    { name: "@parcel/watcher", runtimeDependencies: [parcelWatcherNativePackageName(target)] },
    { name: "node-screenshots", runtimeDependencies: nodeScreenshotsNativePackageNames(target) },
  ]
}

export function artifactRuntimeNodeModuleNames(target: ArtifactNodeRuntimeTarget): string[] {
  return artifactRuntimeNodeModules(target).flatMap((item) => [item.name, ...(item.runtimeDependencies ?? [])])
}

function sharpNativePackageNames(target: ArtifactNodeRuntimeTarget): string[] {
  if (target.os === "win32") return [`@img/sharp-win32-${target.arch}`]
  if (target.os === "darwin") return [`@img/sharp-darwin-${target.arch}`, `@img/sharp-libvips-darwin-${target.arch}`]
  if (target.os === "linux") {
    const family = target.abi === "musl" ? "linuxmusl" : "linux"
    return [`@img/sharp-${family}-${target.arch}`, `@img/sharp-libvips-${family}-${target.arch}`]
  }
  return []
}

function parcelWatcherNativePackageName(target: ArtifactNodeRuntimeTarget): string {
  if (target.os === "linux") {
    return `@parcel/watcher-linux-${target.arch}-${target.abi ?? "glibc"}`
  }
  return `@parcel/watcher-${target.os}-${target.arch}`
}

function nodePtyNativePackageName(target: ArtifactNodeRuntimeTarget): string {
  return `@lydell/node-pty-${target.os}-${target.arch}`
}

function nodeScreenshotsNativePackageNames(target: ArtifactNodeRuntimeTarget): string[] {
  if (target.os === "win32") return [`node-screenshots-win32-${target.arch}-msvc`]
  if (target.os === "darwin") return [`node-screenshots-darwin-${target.arch}`]
  if (target.os === "linux") {
    if (target.arch === "arm64" && target.abi === "musl") return []
    return [`node-screenshots-linux-${target.arch}-${target.abi === "musl" ? "musl" : "gnu"}`]
  }
  return []
}
