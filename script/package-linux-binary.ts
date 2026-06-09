#!/usr/bin/env bun

import { $ } from "bun"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export interface LinuxBinaryTarget {
  distDirName: string
  outputName: string
}

export const LINUX_BINARY_TARGETS: readonly LinuxBinaryTarget[] = [
  {
    distDirName: "opencorvus-linux-x64",
    outputName: "opencorvus-linux-x64",
  },
  {
    distDirName: "opencorvus-linux-x64-baseline",
    outputName: "opencorvus-linux-x64-baseline",
  },
] as const

export interface LinuxBinaryArtifact {
  target: LinuxBinaryTarget
  source: string
  output: string
}

export interface PackageLinuxBinaryOptions {
  skipBuild?: boolean
  platform?: string
  arch?: string
  env?: NodeJS.ProcessEnv
}

export function resolveLinuxBinaryArtifacts(repoRoot: string): LinuxBinaryArtifact[] {
  const opencorvusDist = path.join(repoRoot, "packages", "opencorvus", "dist")
  const outputDir = path.join(opencorvusDist, "bin")
  return LINUX_BINARY_TARGETS.map((target) => ({
    target,
    source: path.join(opencorvusDist, target.distDirName, "opencorvus"),
    output: path.join(outputDir, target.outputName),
  }))
}

export function linuxBinaryBuildEnv(baseEnv: NodeJS.ProcessEnv, packageVersion: string): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    OPENCORVUS_VERSION: baseEnv.OPENCORVUS_VERSION?.trim() || packageVersion,
    OPENCORVUS_CHANNEL: baseEnv.OPENCORVUS_CHANNEL?.trim() || "local",
    OPENCORVUS_DISABLE_MODELS_FETCH: baseEnv.OPENCORVUS_DISABLE_MODELS_FETCH ?? "true",
  }
}

export function assertLinuxX64Host(platform: string, arch: string): void {
  if (platform !== "linux" || arch !== "x64") {
    throw new Error(
      `package-linux-binary must run on linux-x64 so the copied runtime is a Linux binary. ` +
        `Current host is ${platform}-${arch}. Run it inside WSL or a Linux x64 build host.`,
    )
  }
}

export function parsePackageLinuxBinaryArgs(argv: readonly string[]): PackageLinuxBinaryOptions {
  return {
    skipBuild: argv.includes("--skip-build"),
  }
}

async function readPackageVersion(repoRoot: string): Promise<string> {
  const pkg = await Bun.file(path.join(repoRoot, "packages", "opencorvus", "package.json")).json()
  if (!pkg || typeof pkg.version !== "string" || pkg.version.length === 0) {
    throw new Error("packages/opencorvus/package.json is missing a version")
  }
  return pkg.version
}

async function copyBinaryArtifact(artifact: LinuxBinaryArtifact): Promise<void> {
  if (!fs.existsSync(artifact.source)) {
    throw new Error(`Missing built Linux binary: ${artifact.source}`)
  }
  await fs.promises.mkdir(path.dirname(artifact.output), { recursive: true })
  await fs.promises.copyFile(artifact.source, artifact.output)
  await fs.promises.chmod(artifact.output, 0o755)
}

async function verifyBinaryArtifact(artifact: LinuxBinaryArtifact): Promise<string> {
  return (await $`${artifact.output} --version`.text()).trim()
}

export async function packageLinuxBinary(
  repoRoot: string,
  opts: PackageLinuxBinaryOptions = {},
): Promise<LinuxBinaryArtifact[]> {
  assertLinuxX64Host(opts.platform ?? process.platform, opts.arch ?? process.arch)

  const version = await readPackageVersion(repoRoot)
  const env = linuxBinaryBuildEnv(opts.env ?? process.env, version)
  const opencorvusRoot = path.join(repoRoot, "packages", "opencorvus")

  if (!opts.skipBuild) {
    await $`bun run script/build.ts --single --baseline`.cwd(opencorvusRoot).env(env)
  }

  const artifacts = resolveLinuxBinaryArtifacts(repoRoot)
  for (const artifact of artifacts) {
    await copyBinaryArtifact(artifact)
    const actualVersion = await verifyBinaryArtifact(artifact)
    if (actualVersion !== env.OPENCORVUS_VERSION) {
      throw new Error(`Unexpected ${artifact.output} version: ${actualVersion}; expected ${env.OPENCORVUS_VERSION}`)
    }
  }

  return artifacts
}

async function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const artifacts = await packageLinuxBinary(repoRoot, parsePackageLinuxBinaryArgs(process.argv.slice(2)))

  console.log("Linux binaries:")
  for (const artifact of artifacts) {
    const stat = await fs.promises.stat(artifact.output)
    console.log(`  ${path.relative(repoRoot, artifact.output)} (${Math.round(stat.size / 1024 / 1024)} MiB)`)
  }
}

if (import.meta.main) {
  await main()
}
