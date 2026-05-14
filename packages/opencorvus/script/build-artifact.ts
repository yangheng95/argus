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

export function artifactSourcemap(): "none" {
  return "none"
}
