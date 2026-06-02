export type BuildFlavor = "cli" | "overlay-server"

export function parseBuildFlavor(argv: string[]): BuildFlavor {
  return argv.includes("--overlay-server") ? "overlay-server" : "cli"
}

export function artifactPackageBaseName(pkgName: string, flavor: BuildFlavor): string {
  if (flavor === "overlay-server") return `${pkgName}-overlay-server`
  return pkgName
}

export function artifactEntrypoints(flavor: BuildFlavor, parserWorker: string, workerPath: string): string[] {
  if (flavor === "overlay-server") return ["./src/overlay-server.ts"]
  return ["./src/index.ts", parserWorker, workerPath]
}

export function artifactExternalModules(): string[] {
  return [
    // Playwright exposes Electron support as an optional runtime path. The
    // packaged server uses Chromium only, so the compiler must not require
    // Electron to be installed just because Playwright's package graph names it.
    "electron",
  ]
}

export function artifactSourcemap(): "none" {
  return "none"
}

export function artifactBrowserMcpNodeExecutableName(os = process.platform): string {
  return os === "win32" ? "node.exe" : "node"
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

export function artifactHostCanProvideNodeRuntime(
  target: ArtifactNodeRuntimeTarget,
  host: ArtifactNodeRuntimeHost,
): boolean {
  if (target.os !== host.platform || target.arch !== host.arch) return false
  if (target.os !== "linux") return target.abi === undefined
  return (target.abi ?? "glibc") === host.linuxLibc
}
