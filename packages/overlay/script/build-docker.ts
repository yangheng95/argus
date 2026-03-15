#!/usr/bin/env bun
/**
 * Build overlay for Linux targets using Docker.
 * Requires: Docker Desktop running, opencorvus binaries pre-built with --all.
 *
 * Usage:
 *   bun run script/build-docker.ts                         # linux-x64 + linux-arm64
 *   bun run script/build-docker.ts --target=linux-x64      # single target
 */

import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const repo = path.resolve(dir, "../..")
const opencorvus = path.resolve(repo, "packages/opencorvus")
const tauriDir = path.resolve(dir, "src-tauri")
const resources = path.join(tauriDir, "resources")
const overlayUi = path.join(dir, "src")
const dockerDir = path.join(dir, "docker")

const IMAGE_NAME = "opencorvus-overlay-builder"

type Target = "linux-x64" | "linux-arm64"

const argTargets = process.argv
  .filter((a) => a.startsWith("--target="))
  .map((a) => a.split("=")[1] as Target)
const targets: Target[] = argTargets.length > 0 ? argTargets : ["linux-x64", "linux-arm64"]

async function fileExists(p: string) {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false)
}

/** Convert Windows path to Docker-compatible path (for -v mounts in Git Bash/MINGW). */
function toDockerPath(p: string): string {
  if (process.platform === "win32") {
    return p
      .replace(/^([A-Za-z]):[/\\]/, (_, d) => `/${d.toLowerCase()}/`)
      .replaceAll("\\", "/")
  }
  return p
}

async function ensureDockerImage(platform: "linux/amd64" | "linux/arm64") {
  const platformTag = platform.replace("/", "-")
  const tag = `${IMAGE_NAME}:${platformTag}`
  const inspect = await $`docker image inspect ${tag}`.nothrow().quiet()
  if (inspect.exitCode !== 0) {
    console.log(`Building Docker image ${tag} (first time, may take a few minutes)...`)
    await $`docker buildx build --platform ${platform} -t ${tag} ${dockerDir}`
  }
  return tag
}

async function stageResources(serverBin: string) {
  await fs.mkdir(resources, { recursive: true })
  // Stage opencorvus binary (no .exe — Linux binary)
  await fs.copyFile(serverBin, path.join(resources, "opencorvus"))
  // Stage overlay UI
  const uiDest = path.join(resources, "ui")
  await fs.rm(uiDest, { recursive: true, force: true }).catch(() => undefined)
  await fs.cp(overlayUi, uiDest, { recursive: true })
  console.log("  staged: opencorvus binary + ui")
}

for (const target of targets) {
  const [, arch] = target.split("-") as [string, "x64" | "arm64"]
  const dockerPlatform = arch === "x64" ? "linux/amd64" : "linux/arm64"

  console.log(`\n=== overlay ${target} (Docker) ===`)

  // Verify pre-built opencorvus binary exists
  const serverBin = path.join(opencorvus, "dist", `opencorvus-linux-${arch}`, "bin", "opencorvus")
  if (!(await fileExists(serverBin))) {
    console.error(`ERROR: opencorvus binary not found: ${serverBin}`)
    console.error("Run first: cd packages/opencorvus && bun run build --all")
    process.exit(1)
  }

  // Enable QEMU for arm64 if needed
  if (arch === "arm64") {
    console.log("  enabling QEMU arm64 emulation...")
    await $`docker run --privileged --rm tonistiigi/binfmt --install arm64`.nothrow().quiet()
  }

  // Build Docker image if needed
  const image = await ensureDockerImage(dockerPlatform as "linux/amd64" | "linux/arm64")

  // Stage resources (opencorvus binary + UI) onto host fs (mounted into container)
  await stageResources(serverBin)

  // Named volumes for Cargo and build cache (avoids recompiling on every run)
  const cargoVol = `opencorvus-cargo-cache-${arch}`
  const targetVol = `opencorvus-overlay-target-${arch}`

  // Run tauri build inside Docker
  await $`docker run --rm
    --platform ${dockerPlatform}
    -v ${toDockerPath(path.join(dir, "src"))}:/overlay/src:ro
    -v ${toDockerPath(tauriDir)}:/overlay/src-tauri
    -v ${cargoVol}:/root/.cargo/registry
    -v ${targetVol}:/overlay/src-tauri/target
    -w /overlay/src-tauri
    -e CARGO_TARGET_DIR=/overlay/src-tauri/target
    ${image}
    tauri build`

  // Collect artifacts
  const outDir = path.join(dir, "dist-artifacts", target)
  await fs.mkdir(outDir, { recursive: true })

  // The target volume is a named Docker volume — copy artifacts out of it
  const releaseInVol = `/overlay/src-tauri/target/release`
  await $`docker run --rm
    -v ${targetVol}:/overlay/src-tauri/target:ro
    -v ${toDockerPath(outDir)}:/out
    --platform ${dockerPlatform}
    ${image}
    sh -c "cp -f ${releaseInVol}/opencorvus-overlay* /out/ 2>/dev/null || true && find ${releaseInVol}/bundle -type f -exec cp {} /out/ \\; 2>/dev/null || true"`

  console.log(`  artifacts → packages/overlay/dist-artifacts/${target}/`)
}

console.log("\nDocker overlay builds complete.")
